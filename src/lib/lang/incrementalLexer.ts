// An incremental, line-oriented tokenizer. Full re-tokenization is O(document);
// real editors cannot afford that on every keystroke. This layer tokenizes one
// line at a time while carrying a small "open state" across line boundaries
// (inside-block-comment / inside-multiline-string), caches the result per line,
// and on edit re-lexes only from the first changed line forward — stopping as
// soon as the carried state reconverges with the cached state at a line
// boundary. Unchanged tails are reused untouched, so a keystroke costs O(edited
// region) rather than O(document).
//
// The token semantics deliberately mirror the whole-document `tokenize` for the
// constructs that can span lines, so downstream analyzers see the same picture
// regardless of which tokenizer produced the tokens.

import type { LexerConfig, Token, TokenType } from "./lexer";

/** What multi-line construct, if any, a line begins inside of. */
export type OpenState =
  | { kind: "code" }
  | { kind: "block-comment"; close: string }
  | { kind: "string"; close: string; escape?: string };

const CODE: OpenState = { kind: "code" };

function statesEqual(a: OpenState, b: OpenState): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "code") return true;
  if (a.kind === "block-comment" && b.kind === "block-comment") return a.close === b.close;
  if (a.kind === "string" && b.kind === "string") return a.close === b.close && a.escape === b.escape;
  return false;
}

export interface LineTokens {
  /** The raw line text (without its trailing newline). */
  text: string;
  /** State this line began in. */
  inState: OpenState;
  /** State the following line begins in. */
  outState: OpenState;
  /** Tokens with line-relative offsets (0 = first char of the line). */
  tokens: Token[];
}

interface LineLexResult {
  tokens: Token[];
  outState: OpenState;
}

const DEFAULT_ID_START = /[A-Za-z_$]/;
const DEFAULT_ID_PART = /[A-Za-z0-9_$]/;

/**
 * Tokenize a single physical line given the state it starts in. Multi-line
 * constructs are represented as a single token spanning to end-of-line with the
 * appropriate `unterminated`/continuation handling encoded in `outState`.
 */
export function lexLine(line: string, inState: OpenState, config: LexerConfig): LineLexResult {
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
  const sortedOps = [...operators].sort((a, b) => b.length - a.length);
  const tokens: Token[] = [];
  const n = line.length;
  let i = 0;

  // Resume a construct carried in from the previous line.
  if (inState.kind !== "code") {
    const close = inState.close;
    let j = 0;
    if (inState.kind === "string") {
      const escape = inState.escape;
      while (j < n) {
        if (escape && line[j] === escape) { j += 2; continue; }
        if (line.startsWith(close, j)) { j += close.length; break; }
        j += 1;
      }
    } else {
      while (j < n) {
        if (line.startsWith(close, j)) { j += close.length; break; }
        j += 1;
      }
    }
    const closed = j <= n && line.slice(0, j).endsWith(close) && j > 0;
    const type: TokenType = inState.kind === "string" ? "string" : "comment";
    tokens.push({ type, value: line.slice(0, Math.min(j, n)), start: 0, end: Math.min(j, n), ...(closed ? {} : { unterminated: true }) });
    if (!closed) return { tokens, outState: inState };
    i = j;
  }

  while (i < n) {
    const ch = line[i];
    if (ch === " " || ch === "\t" || ch === "\r") { i += 1; continue; }

    let matched = false;

    // Line comments consume to end-of-line.
    for (const marker of lineComments) {
      if (line.startsWith(marker, i)) {
        tokens.push({ type: "comment", value: line.slice(i), start: i, end: n });
        i = n;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Block comments — may run off the end of the line.
    for (const [open, close] of blockComments) {
      if (line.startsWith(open, i)) {
        const start = i;
        let j = i + open.length;
        let closed = false;
        while (j < n) {
          if (line.startsWith(close, j)) { j += close.length; closed = true; break; }
          j += 1;
        }
        tokens.push({ type: "comment", value: line.slice(start, j), start, end: Math.min(j, n), ...(closed ? {} : { unterminated: true }) });
        if (!closed) return { tokens, outState: { kind: "block-comment", close } };
        i = j;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // String literals — multiline strings may run off the end of the line.
    for (const rule of strings) {
      if (!line.startsWith(rule.quote, i)) continue;
      const close = rule.close ?? rule.quote;
      const start = i;
      let j = i + rule.quote.length;
      let closed = false;
      while (j < n) {
        const c = line[j];
        if (rule.escape && c === rule.escape) { j += 2; continue; }
        if (line.startsWith(close, j)) { j += close.length; closed = true; break; }
        j += 1;
      }
      if (!closed && rule.multiline) {
        tokens.push({ type: "string", value: line.slice(start), start, end: n, unterminated: true });
        return { tokens, outState: { kind: "string", close, escape: rule.escape } };
      }
      tokens.push({ type: "string", value: line.slice(start, j), start, end: Math.min(j, n), ...(closed ? {} : { unterminated: true }) });
      i = closed ? j : n;
      matched = true;
      break;
    }
    if (matched) continue;

    // Numbers.
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(line[i + 1] ?? ""))) {
      const start = i;
      let j = i;
      if (ch === "0" && /[xXbBoO]/.test(line[j + 1] ?? "")) {
        j += 2;
        while (j < n && /[0-9a-fA-F_]/.test(line[j])) j += 1;
      } else {
        while (j < n && /[0-9_]/.test(line[j])) j += 1;
        if (line[j] === ".") { j += 1; while (j < n && /[0-9_]/.test(line[j])) j += 1; }
        if (/[eE]/.test(line[j] ?? "")) { j += 1; if (/[+-]/.test(line[j] ?? "")) j += 1; while (j < n && /[0-9]/.test(line[j])) j += 1; }
      }
      tokens.push({ type: "number", value: line.slice(start, j), start, end: j });
      i = j;
      continue;
    }

    // Identifiers / keywords.
    if (identifierStart.test(ch)) {
      const start = i;
      let j = i + 1;
      while (j < n && identifierPart.test(line[j])) j += 1;
      const value = line.slice(start, j);
      tokens.push({ type: keywords?.has(value) ? "keyword" : "identifier", value, start, end: j });
      i = j;
      continue;
    }

    // Brackets.
    if (openBrackets.includes(ch)) { tokens.push({ type: "punctuation", value: ch, start: i, end: i + 1, bracket: "open" }); i += 1; continue; }
    if (closeBrackets.includes(ch)) { tokens.push({ type: "punctuation", value: ch, start: i, end: i + 1, bracket: "close" }); i += 1; continue; }

    // Multi-char operators.
    let opMatched = false;
    for (const op of sortedOps) {
      if (line.startsWith(op, i)) { tokens.push({ type: "operator", value: op, start: i, end: i + op.length }); i += op.length; opMatched = true; break; }
    }
    if (opMatched) continue;

    const type: TokenType = /[;,.:?]/.test(ch) ? "punctuation" : "operator";
    tokens.push({ type, value: ch, start: i, end: i + 1 });
    i += 1;
  }

  return { tokens, outState: CODE };
}

/**
 * A stateful incremental tokenizer over a document's lines. Construct once with
 * the initial text, then call `applyEdit` with each changed line range; only the
 * affected lines (plus any needed for state reconvergence) are re-lexed.
 */
export class IncrementalTokenizer {
  private lines: LineTokens[] = [];

  constructor(source: string, private readonly config: LexerConfig) {
    this.lines = this.lexFrom(source.split("\n"), 0, []);
  }

  /** Current per-line token cache (read-only view). */
  get lineCache(): readonly LineTokens[] {
    return this.lines;
  }

  /** Number of cached lines. */
  get lineCount(): number {
    return this.lines.length;
  }

  /**
   * Replace lines [startLine, endLine) (0-based, end exclusive) with
   * `newTextLines`. Returns the number of lines that were actually re-lexed —
   * useful for asserting the incremental win in tests.
   */
  applyEdit(startLine: number, endLine: number, newTextLines: string[]): number {
    const start = Math.max(0, Math.min(startLine, this.lines.length));
    const end = Math.max(start, Math.min(endLine, this.lines.length));
    const before = this.lines.slice(0, start);
    const after = this.lines.slice(end);
    const inState = before.length ? before[before.length - 1].outState : CODE;

    // Re-lex the replacement lines, then continue into the untouched tail until
    // the carried state matches the tail's cached inState (reconvergence).
    let relexed = 0;
    const rebuilt: LineTokens[] = [];
    let carry = inState;
    for (const text of newTextLines) {
      const res = lexLine(text, carry, this.config);
      rebuilt.push({ text, inState: carry, outState: res.outState, tokens: res.tokens });
      carry = res.outState;
      relexed += 1;
    }

    // Walk the tail: reuse if its recorded inState already equals our carry.
    let tailIndex = 0;
    while (tailIndex < after.length) {
      const cached = after[tailIndex];
      if (statesEqual(cached.inState, carry)) break; // converged — reuse the rest
      const res = lexLine(cached.text, carry, this.config);
      rebuilt.push({ text: cached.text, inState: carry, outState: res.outState, tokens: res.tokens });
      carry = res.outState;
      relexed += 1;
      tailIndex += 1;
    }

    this.lines = [...before, ...rebuilt, ...after.slice(tailIndex)];
    return relexed;
  }

  /** All tokens with absolute document offsets, in reading order. */
  allTokens(): Token[] {
    const out: Token[] = [];
    let offset = 0;
    for (const line of this.lines) {
      for (const t of line.tokens) {
        out.push({ ...t, start: t.start + offset, end: t.end + offset });
      }
      offset += line.text.length + 1; // + newline
    }
    return out;
  }

  private lexFrom(textLines: string[], from: number, prefix: LineTokens[]): LineTokens[] {
    const out = [...prefix];
    let carry = out.length ? out[out.length - 1].outState : CODE;
    for (let l = from; l < textLines.length; l++) {
      const text = textLines[l];
      const res = lexLine(text, carry, this.config);
      out.push({ text, inState: carry, outState: res.outState, tokens: res.tokens });
      carry = res.outState;
    }
    return out;
  }
}
