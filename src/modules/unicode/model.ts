// What is really in a piece of text: every code point with its category,
// script and encodings, characters that cannot be seen or that reorder the
// text (bidi controls), letters from another script that look like Latin
// ones, and how the normalization forms differ.

export interface CodePoint {
  /** Index of the code point in the text (not UTF-16 units). */
  index: number;
  /** UTF-16 offset, for selecting it in an editor. */
  offset: number;
  char: string;
  cp: number;
  /** U+XXXX */
  hex: string;
  name: string;
  category: string;
  script: string;
  utf8: number[];
  utf16: number[];
  issue: Issue | null;
}

export type IssueKind = "invisible" | "bidi" | "confusable" | "control" | "space" | "private" | "replacement";

export interface Issue {
  kind: IssueKind;
  message: string;
  /** What to put in its place when cleaning; "" removes it. */
  replacement: string;
}

/** Names for the characters people actually ask about; the rest get their category. */
const NAMES: Record<number, string> = {
  0x00: "NULL",
  0x09: "CHARACTER TABULATION",
  0x0a: "LINE FEED",
  0x0d: "CARRIAGE RETURN",
  0x20: "SPACE",
  0xa0: "NO-BREAK SPACE",
  0xad: "SOFT HYPHEN",
  0x34f: "COMBINING GRAPHEME JOINER",
  0x61c: "ARABIC LETTER MARK",
  0x115f: "HANGUL CHOSEONG FILLER",
  0x1160: "HANGUL JUNGSEONG FILLER",
  0x180e: "MONGOLIAN VOWEL SEPARATOR",
  0x2000: "EN QUAD",
  0x2001: "EM QUAD",
  0x2002: "EN SPACE",
  0x2003: "EM SPACE",
  0x2004: "THREE-PER-EM SPACE",
  0x2005: "FOUR-PER-EM SPACE",
  0x2006: "SIX-PER-EM SPACE",
  0x2007: "FIGURE SPACE",
  0x2008: "PUNCTUATION SPACE",
  0x2009: "THIN SPACE",
  0x200a: "HAIR SPACE",
  0x200b: "ZERO WIDTH SPACE",
  0x200c: "ZERO WIDTH NON-JOINER",
  0x200d: "ZERO WIDTH JOINER",
  0x200e: "LEFT-TO-RIGHT MARK",
  0x200f: "RIGHT-TO-LEFT MARK",
  0x2010: "HYPHEN",
  0x2011: "NON-BREAKING HYPHEN",
  0x2012: "FIGURE DASH",
  0x2013: "EN DASH",
  0x2014: "EM DASH",
  0x2015: "HORIZONTAL BAR",
  0x2018: "LEFT SINGLE QUOTATION MARK",
  0x2019: "RIGHT SINGLE QUOTATION MARK",
  0x201a: "SINGLE LOW-9 QUOTATION MARK",
  0x201c: "LEFT DOUBLE QUOTATION MARK",
  0x201d: "RIGHT DOUBLE QUOTATION MARK",
  0x201e: "DOUBLE LOW-9 QUOTATION MARK",
  0x2022: "BULLET",
  0x2026: "HORIZONTAL ELLIPSIS",
  0x2028: "LINE SEPARATOR",
  0x2029: "PARAGRAPH SEPARATOR",
  0x202a: "LEFT-TO-RIGHT EMBEDDING",
  0x202b: "RIGHT-TO-LEFT EMBEDDING",
  0x202c: "POP DIRECTIONAL FORMATTING",
  0x202d: "LEFT-TO-RIGHT OVERRIDE",
  0x202e: "RIGHT-TO-LEFT OVERRIDE",
  0x202f: "NARROW NO-BREAK SPACE",
  0x205f: "MEDIUM MATHEMATICAL SPACE",
  0x2060: "WORD JOINER",
  0x2061: "FUNCTION APPLICATION",
  0x2062: "INVISIBLE TIMES",
  0x2063: "INVISIBLE SEPARATOR",
  0x2064: "INVISIBLE PLUS",
  0x2066: "LEFT-TO-RIGHT ISOLATE",
  0x2067: "RIGHT-TO-LEFT ISOLATE",
  0x2068: "FIRST STRONG ISOLATE",
  0x2069: "POP DIRECTIONAL ISOLATE",
  0x2212: "MINUS SIGN",
  0x3000: "IDEOGRAPHIC SPACE",
  0x3164: "HANGUL FILLER",
  0xfe0e: "VARIATION SELECTOR-15 (text style)",
  0xfe0f: "VARIATION SELECTOR-16 (emoji style)",
  0xfeff: "ZERO WIDTH NO-BREAK SPACE (byte order mark)",
  0xfffc: "OBJECT REPLACEMENT CHARACTER",
  0xfffd: "REPLACEMENT CHARACTER",
  0xffa0: "HALFWIDTH HANGUL FILLER",
};

const CATEGORIES: [RegExp, string][] = [
  [/\p{Lu}/u, "Uppercase letter"],
  [/\p{Ll}/u, "Lowercase letter"],
  [/\p{Lt}/u, "Titlecase letter"],
  [/\p{Lm}/u, "Modifier letter"],
  [/\p{Lo}/u, "Letter"],
  [/\p{Mn}/u, "Combining mark"],
  [/\p{Mc}/u, "Spacing mark"],
  [/\p{Me}/u, "Enclosing mark"],
  [/\p{Nd}/u, "Digit"],
  [/\p{Nl}/u, "Letter number"],
  [/\p{No}/u, "Number"],
  [/\p{Pc}/u, "Connector punctuation"],
  [/\p{Pd}/u, "Dash"],
  [/\p{Ps}/u, "Opening punctuation"],
  [/\p{Pe}/u, "Closing punctuation"],
  [/\p{Pi}/u, "Opening quote"],
  [/\p{Pf}/u, "Closing quote"],
  [/\p{Po}/u, "Punctuation"],
  [/\p{Sm}/u, "Math symbol"],
  [/\p{Sc}/u, "Currency symbol"],
  [/\p{Sk}/u, "Modifier symbol"],
  [/\p{So}/u, "Symbol"],
  [/\p{Zs}/u, "Space"],
  [/\p{Zl}/u, "Line separator"],
  [/\p{Zp}/u, "Paragraph separator"],
  [/\p{Cc}/u, "Control character"],
  [/\p{Cf}/u, "Format character"],
  [/\p{Co}/u, "Private use"],
  [/\p{Cs}/u, "Lone surrogate"],
];

const SCRIPTS = ["Latin", "Greek", "Cyrillic", "Armenian", "Hebrew", "Arabic", "Devanagari", "Bengali", "Thai", "Georgian", "Hangul", "Hiragana", "Katakana", "Han", "Ethiopic", "Cherokee", "Tamil", "Telugu", "Gujarati", "Gurmukhi", "Kannada", "Malayalam", "Sinhala", "Tibetan", "Khmer", "Lao", "Mongolian"].map((s) => [new RegExp(`\\p{Script=${s}}`, "u"), s] as const);

export function category(ch: string): string {
  for (const [re, name] of CATEGORIES) if (re.test(ch)) return name;
  return "Unassigned";
}

export function script(ch: string): string {
  for (const [re, name] of SCRIPTS) if (re.test(ch)) return name;
  if (/\p{Script=Common}/u.test(ch)) return "Common";
  if (/\p{Script=Inherited}/u.test(ch)) return "Inherited";
  return "Other";
}

/** Letters and digits from Cyrillic, Greek and others that are drawn like Latin ones. */
export const CONFUSABLES: Record<string, string> = {
  а: "a", в: "B", е: "e", ё: "ë", к: "k", м: "M", н: "H", о: "o", р: "p", с: "c", т: "T", у: "y", х: "x", ѕ: "s", і: "i", ї: "ï", ј: "j", ԁ: "d", ԛ: "q", ԝ: "w", һ: "h", ӏ: "l",
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X", Ѕ: "S", І: "I", Ј: "J", Ԛ: "Q", Ԝ: "W",
  α: "a", ο: "o", ν: "v", ρ: "p", τ: "t", υ: "u", ι: "i", κ: "k", χ: "x",
  Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X",
  "ı": "i", "ℓ": "l", "ꓲ": "l", "Ꭺ": "A", "Ꮯ": "C", "Ꭼ": "E", "Ꮋ": "H", "Ꮃ": "W",
  "０": "0", "１": "1", "２": "2", "３": "3", "４": "4", "５": "5", "６": "6", "７": "7", "８": "8", "９": "9",
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "−": "-", "‘": "'", "’": "'", "‚": "'", "“": '"', "”": '"', "„": '"', "′": "'", "″": '"', "／": "/", "∕": "/", "⁄": "/", "；": ";", ";": ";", "：": ":",
};

const BIDI = new Set([0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]);
const INVISIBLE = new Set([0x00ad, 0x034f, 0x115f, 0x1160, 0x180e, 0x200b, 0x200c, 0x200d, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x3164, 0xfeff, 0xffa0, 0xfe0e, 0xfe0f]);
const ODD_SPACE = new Set([0x00a0, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f, 0x3000, 0x2028, 0x2029]);

/** What is suspicious about one character, given whether the text is otherwise Latin. */
export function issueOf(ch: string, cp: number, latinContext: boolean, prev = ""): Issue | null {
  if (BIDI.has(cp)) return { kind: "bidi", message: "Changes the order text is displayed in, so code can read differently from how it runs (Trojan Source)", replacement: "" };
  if (INVISIBLE.has(cp)) {
    // A joiner or variation selector inside an emoji sequence is part of the emoji.
    if ((cp === 0x200d || cp === 0xfe0f || cp === 0xfe0e) && /\p{Extended_Pictographic}/u.test(prev)) return null;
    return { kind: "invisible", message: cp === 0xfeff ? "Byte order mark: invisible, and breaks scripts and parsers when it is not at the very start" : "Takes no space and cannot be seen", replacement: "" };
  }
  if (ODD_SPACE.has(cp)) return { kind: "space", message: "Looks like a space but is not one; it breaks commands, YAML and comparisons", replacement: cp === 0x2028 || cp === 0x2029 ? "\n" : " " };
  if (cp === 0xfffd) return { kind: "replacement", message: "A character was lost when the text was decoded with the wrong encoding", replacement: "" };
  if (/\p{Cc}/u.test(ch) && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) return { kind: "control", message: "A control character; usually left over from a terminal or a binary file", replacement: "" };
  if (/\p{Co}/u.test(ch)) return { kind: "private", message: "A private-use character: shows as an icon only with one particular font", replacement: "" };
  const look = CONFUSABLES[ch];
  if (look !== undefined && (latinContext || /[-'"/;:0-9]/.test(look))) {
    return { kind: "confusable", message: `Looks like “${look}” but is ${script(ch) === "Common" ? category(ch).toLowerCase() : `${script(ch)} ${category(ch).toLowerCase()}`}`, replacement: look };
  }
  return null;
}

function utf8Bytes(cp: number): number[] {
  if (cp < 0x80) return [cp];
  if (cp < 0x800) return [0xc0 | (cp >> 6), 0x80 | (cp & 63)];
  if (cp < 0x10000) return [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
  return [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
}

export const hexOf = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

/** True when most letters in the text are Latin, so look-alikes from other scripts stand out. */
export function isLatinText(text: string): boolean {
  let latin = 0;
  let other = 0;
  for (const ch of text) {
    if (/\p{Script=Latin}/u.test(ch)) latin++;
    else if (/\p{L}/u.test(ch) && !CONFUSABLES[ch]) other++;
  }
  return latin > 0 && latin >= other * 3;
}

export function codePoints(text: string, limit = 20000): CodePoint[] {
  const latin = isLatinText(text);
  const out: CodePoint[] = [];
  let offset = 0;
  let index = 0;
  let prev = "";
  for (const ch of text) {
    if (index >= limit) break;
    const cp = ch.codePointAt(0) ?? 0;
    const cat = category(ch);
    out.push({
      index,
      offset,
      char: ch,
      cp,
      hex: hexOf(cp),
      name: NAMES[cp] ?? (cp >= 0x21 && cp <= 0x7e ? `${cat.toUpperCase()} ${ch}` : cat.toUpperCase()),
      category: cat,
      script: script(ch),
      utf8: utf8Bytes(cp),
      utf16: ch.length === 2 ? [ch.charCodeAt(0), ch.charCodeAt(1)] : [ch.charCodeAt(0)],
      issue: issueOf(ch, cp, latin, prev),
    });
    offset += ch.length;
    index++;
    prev = ch;
  }
  return out;
}

export interface Stats {
  codePoints: number;
  utf16Units: number;
  utf8Bytes: number;
  graphemes: number;
  lines: number;
  words: number;
  nonAscii: number;
  scripts: { script: string; count: number }[];
  issues: Record<IssueKind, number>;
}

export function graphemeCount(text: string): number {
  // Intl.Segmenter is newer than the TypeScript lib this project targets.
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale: undefined, opts: { granularity: "grapheme" }) => { segment(s: string): Iterable<unknown> } }).Segmenter;
  if (Segmenter) {
    let n = 0;
    for (const _ of new Segmenter(undefined, { granularity: "grapheme" }).segment(text)) n++;
    return n;
  }
  return [...text].filter((c) => !/\p{M}|\u200d|[\ufe00-\ufe0f]/u.test(c)).length;
}

export function stats(text: string, points = codePoints(text, Infinity)): Stats {
  const scripts = new Map<string, number>();
  const issues: Record<IssueKind, number> = { invisible: 0, bidi: 0, confusable: 0, control: 0, space: 0, private: 0, replacement: 0 };
  let bytes = 0;
  let nonAscii = 0;
  for (const p of points) {
    bytes += p.utf8.length;
    if (p.cp > 0x7f) nonAscii++;
    if (/\p{L}/u.test(p.char)) scripts.set(p.script, (scripts.get(p.script) ?? 0) + 1);
    if (p.issue) issues[p.issue.kind]++;
  }
  return {
    codePoints: points.length,
    utf16Units: text.length,
    utf8Bytes: bytes,
    graphemes: graphemeCount(text),
    lines: text ? text.split(/\r\n|\r|\n/).length : 0,
    words: (text.match(/[\p{L}\p{N}_'’-]+/gu) ?? []).length,
    nonAscii,
    scripts: [...scripts].map(([script, count]) => ({ script, count })).sort((a, b) => b.count - a.count),
    issues,
  };
}

export interface CleanOptions {
  kinds: Set<IssueKind>;
}

/** The text with the chosen kinds of problem characters removed or replaced. */
export function clean(text: string, opts: CleanOptions): { text: string; changed: number } {
  let out = "";
  let changed = 0;
  for (const p of codePoints(text, Infinity)) {
    if (p.issue && opts.kinds.has(p.issue.kind) && !(p.cp === 0xfeff && p.index === 0 && !opts.kinds.has("invisible"))) {
      out += p.issue.replacement;
      changed++;
    } else out += p.char;
  }
  return { text: out, changed };
}

/** Where bidi controls sit in source code, by line, for a Trojan Source check. */
export function findBidi(text: string): { line: number; column: number; hex: string; name: string }[] {
  const out: { line: number; column: number; hex: string; name: string }[] = [];
  let line = 1;
  let column = 1;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ch === "\n") {
      line++;
      column = 1;
      continue;
    }
    if (BIDI.has(cp)) out.push({ line, column, hex: hexOf(cp), name: NAMES[cp] ?? "" });
    column++;
  }
  return out;
}

export type Form = "NFC" | "NFD" | "NFKC" | "NFKD";
export const FORMS: Form[] = ["NFC", "NFD", "NFKC", "NFKD"];

export function normalizations(text: string): { form: Form; text: string; same: boolean; codePoints: number }[] {
  return FORMS.map((form) => {
    const t = text.normalize(form);
    return { form, text: t, same: t === text, codePoints: [...t].length };
  });
}

export type EscapeStyle = "js" | "json" | "python" | "rust" | "css" | "html" | "url" | "java";

/** The text with every non-ASCII or invisible character written as an escape. */
export function escapeText(text: string, style: EscapeStyle): string {
  if (style === "url") return encodeURIComponent(text);
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const plain = cp >= 0x20 && cp < 0x7f;
    if (plain && !(style === "html" && /[<>&"']/.test(ch)) && !((style === "js" || style === "json" || style === "java" || style === "python" || style === "rust") && (ch === "\\" || ch === '"'))) {
      out += ch;
      continue;
    }
    const h4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");
    switch (style) {
      case "js":
        out += plain ? `\\${ch}` : cp > 0xffff ? `\\u{${cp.toString(16).toUpperCase()}}` : cp === 10 ? "\\n" : cp === 9 ? "\\t" : cp === 13 ? "\\r" : `\\u${h4(cp)}`;
        break;
      case "json":
      case "java":
        out += plain ? `\\${ch}` : cp === 10 ? "\\n" : cp === 9 ? "\\t" : cp === 13 ? "\\r" : ch.length === 2 ? `\\u${h4(ch.charCodeAt(0))}\\u${h4(ch.charCodeAt(1))}` : `\\u${h4(cp)}`;
        break;
      case "python":
        out += plain ? `\\${ch}` : cp === 10 ? "\\n" : cp === 9 ? "\\t" : cp === 13 ? "\\r" : cp > 0xffff ? `\\U${cp.toString(16).toUpperCase().padStart(8, "0")}` : cp < 0x100 ? `\\x${cp.toString(16).toUpperCase().padStart(2, "0")}` : `\\u${h4(cp)}`;
        break;
      case "rust":
        out += plain ? `\\${ch}` : cp === 10 ? "\\n" : cp === 9 ? "\\t" : cp === 13 ? "\\r" : `\\u{${cp.toString(16).toUpperCase()}}`;
        break;
      case "css":
        out += `\\${cp.toString(16).toUpperCase()} `;
        break;
      case "html":
        out += `&#x${cp.toString(16).toUpperCase()};`;
        break;
    }
  }
  return out;
}

/** Reads `U+00E9`, `é`, `\u{1F600}`, `\x41`, `&#233;`, `&#xE9;` and `%C3%A9` back into text. */
export function unescapeText(text: string): string {
  let s = text.replace(/(?:%[0-9a-f]{2})+/gi, (m) => {
    try {
      return decodeURIComponent(m);
    } catch {
      return m;
    }
  });
  s = s.replace(/\\u\{([0-9a-f]{1,6})\}|\\U([0-9a-f]{8})|\\u([dD][89abAB][0-9a-fA-F]{2})\\u([dD][c-fC-F][0-9a-fA-F]{2})|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})|U\+([0-9a-f]{4,6})|&#x([0-9a-f]+);|&#(\d+);/gi, (m, a, b, hi, lo, c, d, e, f, g) => {
    if (hi) return String.fromCharCode(parseInt(hi, 16), parseInt(lo, 16));
    const n = parseInt(a ?? b ?? c ?? d ?? e ?? f ?? "", 16);
    const v = g !== undefined ? Number(g) : n;
    return Number.isFinite(v) && v <= 0x10ffff ? String.fromCodePoint(v) : m;
  });
  return s.replace(/\\([nrt\\"'])/g, (_, c) => ({ n: "\n", r: "\r", t: "\t" })[c as "n" | "r" | "t"] ?? c);
}
