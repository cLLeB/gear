// Convert a string literal between quote styles, re-escaping its contents:
// 'it\'s' → "it's" → `it's`. Template literals with ${…} are only converted
// back when they contain no interpolation.

export type QuoteChar = "'" | '"' | "`";

/** Find the string literal on `line` that contains `offset`. */
export function stringAt(line: string, offset: number): { from: number; to: number; quote: QuoteChar } | null {
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < line.length && line[j] !== c) j += line[j] === "\\" ? 2 : 1;
      if (j >= line.length) return null; // unterminated
      if (offset >= i && offset <= j + 1) return { from: i, to: j + 1, quote: c };
      i = j + 1;
    } else if (c === "/" && line[i + 1] === "/") {
      return null; // rest is a comment
    } else i++;
  }
  return null;
}

/** Unescape a literal body written with `quote` into its raw characters. */
function unescapeBody(body: string, quote: QuoteChar): string {
  return body.replace(/\\(.)/g, (m, ch: string) => (ch === quote || (ch === "'" && quote !== "'") || (ch === '"' && quote !== '"') ? ch : m));
}

function escapeBody(raw: string, quote: QuoteChar): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "\\") {
      out += c + (raw[i + 1] ?? "");
      i++;
    } else if (c === quote) out += `\\${c}`;
    else out += c;
  }
  return out;
}

export function convertQuotes(literal: string, to: QuoteChar): string | null {
  const from = literal[0] as QuoteChar;
  if (!["'", '"', "`"].includes(from) || literal[literal.length - 1] !== from) return null;
  const body = literal.slice(1, -1);
  if (from === "`" && /\$\{/.test(body)) return null; // interpolation has no equivalent
  if (from === "`" && body.includes("\n")) return null;
  const raw = unescapeBody(body, from);
  const escaped = escapeBody(raw, to);
  // A literal "${" would start interpolation inside backticks.
  return `${to}${to === "`" ? escaped.replace(/\$\{/g, "\\${") : escaped}${to}`;
}

export function nextQuote(q: QuoteChar): QuoteChar {
  return q === "'" ? '"' : q === '"' ? "`" : "'";
}
