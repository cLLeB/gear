// Regex workbench: running a pattern, splitting text into matched / unmatched
// segments, explaining the pattern piece by piece and writing it out as code.

export const FLAGS = [
  { flag: "g", name: "global", hint: "find every match, not just the first" },
  { flag: "i", name: "ignore case", hint: "a matches A" },
  { flag: "m", name: "multiline", hint: "^ and $ match at every line" },
  { flag: "s", name: "dot all", hint: ". also matches a newline" },
  { flag: "u", name: "unicode", hint: "treat the pattern as code points; enables \\p{…}" },
  { flag: "y", name: "sticky", hint: "match only at the current position" },
] as const;

export interface Match {
  index: number;
  end: number;
  text: string;
  /** Numbered groups, 1-based position i-1; undefined when a group did not take part. */
  groups: (string | undefined)[];
  named: Record<string, string | undefined>;
}

export interface RunResult {
  matches: Match[];
  error: string | null;
  /** True when the match limit stopped the search early. */
  truncated: boolean;
}

export const MATCH_LIMIT = 5000;

export function compile(pattern: string, flags: string): { regex: RegExp } | { error: string } {
  try {
    return { regex: new RegExp(pattern, flags) };
  } catch (err) {
    return { error: (err as Error).message.replace(/^Invalid regular expression: /, "") };
  }
}

export function run(pattern: string, flags: string, text: string): RunResult {
  if (!pattern) return { matches: [], error: null, truncated: false };
  const c = compile(pattern, flags);
  if ("error" in c) return { matches: [], error: c.error, truncated: false };
  const { regex } = c;
  const matches: Match[] = [];
  const push = (m: RegExpExecArray) => matches.push({ index: m.index, end: m.index + m[0].length, text: m[0], groups: m.slice(1), named: { ...(m.groups ?? {}) } });
  if (!regex.global && !regex.sticky) {
    const m = regex.exec(text);
    if (m) push(m);
    return { matches, error: null, truncated: false };
  }
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    push(m);
    if (!regex.global) break;
    if (matches.length >= MATCH_LIMIT) return { matches, error: null, truncated: true };
    // An empty match would otherwise be found again at the same place, forever.
    if (m[0] === "") regex.lastIndex += regex.unicode && (text.codePointAt(regex.lastIndex) ?? 0) > 0xffff ? 2 : 1;
    if (regex.lastIndex > text.length) break;
  }
  return { matches, error: null, truncated: false };
}

export interface Segment {
  text: string;
  /** Index into the match list, or -1 for text between matches. */
  match: number;
}

export function segments(text: string, matches: Match[]): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  matches.forEach((m, i) => {
    if (m.end <= m.index || m.index < at) return;
    if (m.index > at) out.push({ text: text.slice(at, m.index), match: -1 });
    out.push({ text: text.slice(m.index, m.end), match: i });
    at = m.end;
  });
  if (at < text.length) out.push({ text: text.slice(at), match: -1 });
  return out;
}

export function replaceAll(pattern: string, flags: string, text: string, replacement: string): { result: string } | { error: string } {
  const c = compile(pattern, flags);
  if ("error" in c) return { error: c.error };
  return { result: text.replace(c.regex, replacement) };
}

export interface Piece {
  /** The part of the pattern being described. */
  source: string;
  meaning: string;
  depth: number;
}

const ESCAPES: Record<string, string> = {
  d: "a digit (0–9)",
  D: "anything but a digit",
  w: "a word character (letter, digit or _)",
  W: "anything but a word character",
  s: "whitespace (space, tab, newline…)",
  S: "anything but whitespace",
  b: "a word boundary",
  B: "not a word boundary",
  n: "a newline",
  r: "a carriage return",
  t: "a tab",
  f: "a form feed",
  v: "a vertical tab",
  "0": "a null character",
};

function quantifier(q: string): string {
  const lazy = q.length > 1 && q.endsWith("?") ? ", as few as possible" : "";
  const core = lazy ? q.slice(0, -1) : q;
  if (core === "*") return `zero or more times${lazy}`;
  if (core === "+") return `one or more times${lazy}`;
  if (core === "?") return `optional${lazy}`;
  const m = /^\{(\d+)(,(\d*))?\}$/.exec(core);
  if (!m) return `repeated ${core}`;
  if (m[2] === undefined) return `exactly ${m[1]} times`;
  if (m[3] === "") return `${m[1]} or more times${lazy}`;
  return `between ${m[1]} and ${m[3]} times${lazy}`;
}

/** A plain-language walk through the pattern, one piece per line. */
export function explain(pattern: string): Piece[] {
  const out: Piece[] = [];
  let depth = 0;
  let i = 0;
  let group = 0;
  const add = (source: string, meaning: string) => out.push({ source, meaning, depth });
  while (i < pattern.length) {
    const ch = pattern[i];
    const rest = pattern.slice(i);
    let m: RegExpExecArray | null;
    if (ch === "\\") {
      const next = pattern[i + 1] ?? "";
      if ((m = /^\\([pP])\{([^}]*)\}/.exec(rest))) add(m[0], `${m[1] === "p" ? "a character with" : "a character without"} the Unicode property ${m[2]}`);
      else if ((m = /^\\k<([^>]+)>/.exec(rest))) add(m[0], `the same text as the group named "${m[1]}"`);
      else if ((m = /^\\x[0-9a-fA-F]{2}|^\\u[0-9a-fA-F]{4}|^\\u\{[0-9a-fA-F]+\}/.exec(rest))) add(m[0], `the character with code ${m[0].replace(/^\\[xu]\{?|\}$/g, "").toUpperCase()}`);
      else if ((m = /^\\[1-9]\d*/.exec(rest))) add(m[0], `the same text as group ${m[0].slice(1)}`);
      else if ((m = /^\\c[A-Za-z]/.exec(rest))) add(m[0], `the control character Ctrl+${m[0][2].toUpperCase()}`);
      else add(`\\${next}`, ESCAPES[next] ?? `a literal "${next}"`);
      i += out[out.length - 1].source.length;
    } else if (ch === "[") {
      let j = i + 1;
      if (pattern[j] === "^") j++;
      if (pattern[j] === "]") j++;
      while (j < pattern.length && pattern[j] !== "]") j += pattern[j] === "\\" ? 2 : 1;
      const source = pattern.slice(i, Math.min(j + 1, pattern.length));
      const negated = source[1] === "^";
      add(source, `${negated ? "any character except" : "one of"}: ${source.slice(negated ? 2 : 1, -1) || "(nothing)"}`);
      i += source.length;
    } else if (ch === "(") {
      if ((m = /^\(\?<([A-Za-z_$][\w$]*)>/.exec(rest))) add(m[0], `start of group ${++group}, named "${m[1]}"`);
      else if (rest.startsWith("(?:")) add("(?:", "start of a group that is not captured");
      else if (rest.startsWith("(?=")) add("(?=", "followed by (lookahead, not part of the match):");
      else if (rest.startsWith("(?!")) add("(?!", "not followed by (lookahead):");
      else if (rest.startsWith("(?<=")) add("(?<=", "preceded by (lookbehind, not part of the match):");
      else if (rest.startsWith("(?<!")) add("(?<!", "not preceded by (lookbehind):");
      else add("(", `start of group ${++group}`);
      i += out[out.length - 1].source.length;
      depth++;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
      add(")", "end of the group");
      i++;
    } else if ((m = /^(\*|\+|\?|\{\d+(,\d*)?\})\??/.exec(rest)) && out.length) {
      add(m[0], `the previous piece, ${quantifier(m[0])}`);
      i += m[0].length;
    } else if (ch === "|") {
      add("|", "or");
      i++;
    } else if (ch === "^") {
      add("^", "the start of the text (or of a line, with the m flag)");
      i++;
    } else if (ch === "$") {
      add("$", "the end of the text (or of a line, with the m flag)");
      i++;
    } else if (ch === ".") {
      add(".", "any character (except a newline, without the s flag)");
      i++;
    } else {
      // A run of ordinary characters reads better as one piece — but a quantifier binds to the last one only.
      let j = i;
      while (j < pattern.length && !"\\[()|^$.*+?{".includes(pattern[j])) j++;
      if (j === i) j = i + 1;
      if (j - i > 1 && /[*+?{]/.test(pattern[j] ?? "")) j--;
      const source = pattern.slice(i, j);
      add(source, source.length === 1 ? `the character "${source}"` : `the text "${source}"`);
      i = j;
    }
  }
  return out;
}

export type Lang = "javascript" | "python" | "go" | "rust" | "grep";

export function codeFor(lang: Lang, pattern: string, flags: string): string {
  const inline = [...flags].filter((f) => "ims".includes(f)).join("");
  const prefixed = inline ? `(?${inline})${pattern}` : pattern;
  switch (lang) {
    case "javascript":
      return `const re = /${pattern.replace(/\//g, "\\/") || "(?:)"}/${flags};\nconst matches = [...text.matchAll(${flags.includes("g") ? "re" : `new RegExp(re, re.flags + "g")`})];`;
    case "python": {
      const f = [flags.includes("i") && "re.IGNORECASE", flags.includes("m") && "re.MULTILINE", flags.includes("s") && "re.DOTALL"].filter(Boolean).join(" | ");
      // Python spells named groups (?P<name>…).
      const py = pattern.replace(/\(\?<([A-Za-z_]\w*)>/g, "(?P<$1>").replace(/\\k<([^>]+)>/g, "(?P=$1)");
      return `import re\n\npattern = re.compile(r"${py.replace(/"/g, '\\"')}"${f ? `, ${f}` : ""})\nmatches = pattern.${flags.includes("g") ? "findall" : "search"}(text)`;
    }
    case "go":
      return `re := regexp.MustCompile(\`${prefixed.replace(/\(\?<([A-Za-z_]\w*)>/g, "(?P<$1>").replace(/`/g, "\\x60")}\`)\nmatches := re.${flags.includes("g") ? "FindAllString(text, -1)" : "FindString(text)"}`;
    case "rust":
      return `let re = regex::Regex::new(r#"${prefixed}"#).unwrap();\n${flags.includes("g") ? "let matches: Vec<&str> = re.find_iter(text).map(|m| m.as_str()).collect();" : "let first = re.find(text).map(|m| m.as_str());"}`;
    default:
      return `grep -${flags.includes("i") ? "i" : ""}${flags.includes("g") ? "o" : ""}P '${pattern.replace(/'/g, "'\\''")}' file.txt`;
  }
}

export const LIBRARY: { name: string; pattern: string; flags: string; sample: string }[] = [
  { name: "E-mail address", pattern: "[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+", flags: "g", sample: "Write to ada@example.org or linus.t@kernel.dev today." },
  { name: "URL", pattern: "https?://[^\\s<>\"')\\]]+", flags: "gi", sample: "See https://example.org/docs?page=2 and http://localhost:3000/." },
  { name: "IPv4 address", pattern: "\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\b", flags: "g", sample: "Hosts 10.0.0.1 and 192.168.1.254 answered; 999.1.1.1 is not valid." },
  { name: "ISO date", pattern: "(?<year>\\d{4})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12]\\d|3[01])", flags: "g", sample: "Released 2026-01-31, patched 2026-02-14." },
  { name: "UUID", pattern: "\\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b", flags: "gi", sample: "id=3f2b8c1e-9d4a-4f6b-8a2e-1c5d7e9f0a1b" },
  { name: "Hex colour", pattern: "#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\\b", flags: "gi", sample: "color: #fff; background: #1a2b3c; border: #1a2b3c80;" },
  { name: "Semantic version", pattern: "\\bv?(\\d+)\\.(\\d+)\\.(\\d+)(?:-([\\w.]+))?\\b", flags: "g", sample: "Upgrade from v1.4.2 to 2.0.0-rc.1." },
  { name: "Whole number or decimal", pattern: "-?\\b\\d+(?:\\.\\d+)?\\b", flags: "g", sample: "Totals: 42, -7 and 3.14." },
  { name: "Trailing whitespace", pattern: "[ \\t]+$", flags: "gm", sample: "line one   \nline two\t\nline three" },
  { name: "Repeated word", pattern: "\\b(\\w+)\\s+\\1\\b", flags: "gi", sample: "This is is a test of the the pattern." },
];
