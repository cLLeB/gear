// Find/replace across files: query parsing and the replacement itself, kept
// pure so the preview and the write agree exactly.

export interface FindQuery {
  /** Pattern for the native (Rust regex) grep. */
  grepPattern: string;
  /** Equivalent JavaScript regex (global). */
  regex: RegExp;
  caseInsensitive: boolean;
  isRegex: boolean;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * "/pat/flags" is a regex (flags: i, w for whole word); anything else is a
 * literal. A literal with an uppercase letter is case-sensitive, otherwise not
 * (smart case, like ripgrep -S).
 */
export function parseFindQuery(input: string): FindQuery {
  const m = /^\/(.+)\/([iw]*)$/s.exec(input);
  if (m) {
    const ci = m[2].includes("i");
    const body = m[2].includes("w") ? `\\b(?:${m[1]})\\b` : m[1];
    return { grepPattern: body, regex: new RegExp(body, ci ? "gi" : "g"), caseInsensitive: ci, isRegex: true };
  }
  const ci = input === input.toLowerCase();
  const body = escapeRegex(input);
  return { grepPattern: body, regex: new RegExp(body, ci ? "gi" : "g"), caseInsensitive: ci, isRegex: false };
}

/**
 * Expand a replacement template. Regex queries support $1…$9, $& and $<name>;
 * literal queries insert the text verbatim. Also supports \n and \t escapes
 * and case operators \U…\E / \L…\E / \u / \l (VS Code style).
 */
export function expandReplacement(template: string, match: RegExpExecArray, isRegex: boolean): string {
  if (!isRegex) return template;
  let out = template.replace(/\$(\d+|&|<(\w+)>)/g, (_m, g: string, name?: string) => {
    if (g === "&") return match[0];
    if (name) return match.groups?.[name] ?? "";
    return match[Number(g)] ?? "";
  });
  out = out.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  out = out.replace(/\\U([\s\S]*?)(\\E|$)/g, (_m, s: string) => s.toUpperCase());
  out = out.replace(/\\L([\s\S]*?)(\\E|$)/g, (_m, s: string) => s.toLowerCase());
  out = out.replace(/\\u([\s\S])/g, (_m, c: string) => c.toUpperCase());
  out = out.replace(/\\l([\s\S])/g, (_m, c: string) => c.toLowerCase());
  return out;
}

export function replaceInText(text: string, q: FindQuery, template: string): { text: string; count: number } {
  const re = new RegExp(q.regex.source, q.regex.flags);
  let count = 0;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0] === "" ) {
      re.lastIndex++;
      continue;
    }
    count++;
    out += text.slice(last, m.index) + expandReplacement(template, m, q.isRegex);
    last = m.index + m[0].length;
  }
  return { text: out + text.slice(last), count };
}

/** One-line preview: "before ⟶ after" for the first match on a line. */
export function previewLine(line: string, q: FindQuery, template: string): string {
  return replaceInText(line.trim(), q, template).text;
}
