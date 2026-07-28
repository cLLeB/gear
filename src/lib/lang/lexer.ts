// A table-driven, allocation-light lexer used across Gear's code-intelligence
// features (diagnostics, symbol outline, complexity, folding). It is not a full
// grammar — it classifies source into coarse tokens (strings, comments,
// numbers, identifiers, operators, punctuation) while correctly skipping over
// string and comment content so downstream analyzers never mistake a bracket
// inside a string for real structure. It also reports unterminated strings and
// block comments, which several analyzers surface as diagnostics.

export type TokenType =
  | "identifier"
  | "keyword"
  | "number"
  | "string"
  | "comment"
  | "operator"
  | "punctuation"
  | "unknown";

export interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
  /** True for a string/comment token whose closing delimiter was never found. */
  unterminated?: boolean;
  /** For punctuation tokens that are brackets, the matching partner char. */
  bracket?: "open" | "close";
}

export interface StringRule {
  quote: string;
  escape?: string;
  /** Allow the string to span multiple lines (e.g. template/backtick, Python triple). */
  multiline?: boolean;
  /** Optional distinct closing delimiter (defaults to `quote`). */
  close?: string;
}

export interface LexerConfig {
  lineComments?: string[];
  blockComments?: Array<[string, string]>;
  strings?: StringRule[];
  keywords?: ReadonlySet<string>;
  /** Characters allowed to start an identifier. Defaults to letters, _ and $. */
  identifierStart?: RegExp;
  identifierPart?: RegExp;
  /** Bracket characters treated as structural punctuation. */
  openBrackets?: string;
  closeBrackets?: string;
  /** Multi-character operators to match greedily (longest first). */
  operators?: string[];
}

const DEFAULT_ID_START = /[A-Za-z_$]/;
const DEFAULT_ID_PART = /[A-Za-z0-9_$]/;

function startsWith(source: string, index: number, text: string): boolean {
  return source.startsWith(text, index);
}

/**
 * Tokenize `source` according to `config`. The returned tokens cover every
 * non-whitespace character exactly once, in order, with absolute offsets.
 */
export function tokenize(source: string, config: LexerConfig = {}): Token[] {
  const {
    lineComments = [],
    blockComments = [],
    strings = [],
    keywords,
    identifierStart = DEFAULT_ID_START,
    identifierPart = DEFAULT_ID_PART,
    openBrackets = "([{",
    closeBrackets = ")]}",
    operators = [],
  } = config;

  // Longest operators first so "===" wins over "==".
  const sortedOps = [...operators].sort((a, b) => b.length - a.length);
  const tokens: Token[] = [];
  const n = source.length;
  let i = 0;

  while (i < n) {
    const ch = source[i];

    // Whitespace (including newlines) is skipped but not emitted.
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i += 1;
      continue;
    }

    // Line comments.
    let matched = false;
    for (const marker of lineComments) {
      if (startsWith(source, i, marker)) {
        const start = i;
        let j = i + marker.length;
        while (j < n && source[j] !== "\n") j += 1;
        tokens.push({ type: "comment", value: source.slice(start, j), start, end: j });
        i = j;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Block comments.
    for (const [open, close] of blockComments) {
      if (startsWith(source, i, open)) {
        const start = i;
        let j = i + open.length;
        let closed = false;
        while (j < n) {
          if (startsWith(source, j, close)) {
            j += close.length;
            closed = true;
            break;
          }
          j += 1;
        }
        tokens.push({
          type: "comment",
          value: source.slice(start, j),
          start,
          end: j,
          ...(closed ? {} : { unterminated: true }),
        });
        i = j;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // String literals.
    for (const rule of strings) {
      if (!startsWith(source, i, rule.quote)) continue;
      const close = rule.close ?? rule.quote;
      const start = i;
      let j = i + rule.quote.length;
      let closed = false;
      while (j < n) {
        const c = source[j];
        if (rule.escape && c === rule.escape) {
          j += 2;
          continue;
        }
        if (!rule.multiline && c === "\n") break;
        if (startsWith(source, j, close)) {
          j += close.length;
          closed = true;
          break;
        }
        j += 1;
      }
      tokens.push({
        type: "string",
        value: source.slice(start, j),
        start,
        end: j,
        ...(closed ? {} : { unterminated: true }),
      });
      i = j;
      matched = true;
      break;
    }
    if (matched) continue;

    // Numbers (incl. hex/binary/float/exponent — coarse but useful).
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
      const start = i;
      let j = i;
      if (ch === "0" && /[xXbBoO]/.test(source[j + 1] ?? "")) {
        j += 2;
        while (j < n && /[0-9a-fA-F_]/.test(source[j])) j += 1;
      } else {
        while (j < n && /[0-9_]/.test(source[j])) j += 1;
        if (source[j] === ".") {
          j += 1;
          while (j < n && /[0-9_]/.test(source[j])) j += 1;
        }
        if (/[eE]/.test(source[j] ?? "")) {
          j += 1;
          if (/[+-]/.test(source[j] ?? "")) j += 1;
          while (j < n && /[0-9]/.test(source[j])) j += 1;
        }
      }
      tokens.push({ type: "number", value: source.slice(start, j), start, end: j });
      i = j;
      continue;
    }

    // Identifiers / keywords.
    if (identifierStart.test(ch)) {
      const start = i;
      let j = i + 1;
      while (j < n && identifierPart.test(source[j])) j += 1;
      const value = source.slice(start, j);
      tokens.push({
        type: keywords?.has(value) ? "keyword" : "identifier",
        value,
        start,
        end: j,
      });
      i = j;
      continue;
    }

    // Brackets.
    if (openBrackets.includes(ch)) {
      tokens.push({ type: "punctuation", value: ch, start: i, end: i + 1, bracket: "open" });
      i += 1;
      continue;
    }
    if (closeBrackets.includes(ch)) {
      tokens.push({ type: "punctuation", value: ch, start: i, end: i + 1, bracket: "close" });
      i += 1;
      continue;
    }

    // Multi-char operators.
    let opMatched = false;
    for (const op of sortedOps) {
      if (startsWith(source, i, op)) {
        tokens.push({ type: "operator", value: op, start: i, end: i + op.length });
        i += op.length;
        opMatched = true;
        break;
      }
    }
    if (opMatched) continue;

    // Single punctuation / operator fallback.
    const type: TokenType = /[;,.:?]/.test(ch) ? "punctuation" : "operator";
    tokens.push({ type, value: ch, start: i, end: i + 1 });
    i += 1;
  }

  return tokens;
}
