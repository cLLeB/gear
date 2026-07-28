// Bracket-pair analysis built on the shared lexer, which already skips over
// string and comment content — so a `)` inside a string never confuses the
// matcher. A single O(n) stack pass yields three editor features: depth-tagged
// pairs for rainbow bracket colorization, a list of unmatched/mismatched
// brackets for diagnostics, and cursor->partner lookup for bracket matching and
// jump-to-match. Bracket kinds must agree — a `[` closed by a `}` is reported as
// a mismatch, not silently accepted.

import { getLanguageSpec } from "./languages";
import { tokenize } from "./lexer";

const OPEN_TO_CLOSE: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const CLOSE_TO_OPEN: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

export interface BracketPos {
  from: number;
  to: number;
  char: string;
}

export interface BracketPair {
  open: BracketPos;
  close: BracketPos;
  /** 0-based nesting depth (outermost pair is 0) — the colorization index. */
  depth: number;
}

export interface UnmatchedBracket extends BracketPos {
  reason: "unmatched-open" | "unmatched-close" | "mismatch";
  /** For a mismatch, the bracket that was actually on top of the stack. */
  expected?: string;
}

export interface BracketAnalysis {
  pairs: BracketPair[];
  unmatched: UnmatchedBracket[];
}

/** Analyze all bracket pairs in a document. */
export function computeBracketPairs(source: string, languageId: string): BracketAnalysis {
  const spec = getLanguageSpec(languageId);
  if (!spec) return { pairs: [], unmatched: [] };
  const tokens = tokenize(source, spec.lexer);

  const pairs: BracketPair[] = [];
  const unmatched: UnmatchedBracket[] = [];
  const stack: BracketPos[] = [];

  for (const tok of tokens) {
    if (tok.bracket === "open" && OPEN_TO_CLOSE[tok.value]) {
      stack.push({ from: tok.start, to: tok.end, char: tok.value });
      continue;
    }
    if (tok.bracket === "close" && CLOSE_TO_OPEN[tok.value]) {
      const close: BracketPos = { from: tok.start, to: tok.end, char: tok.value };
      const top = stack[stack.length - 1];
      if (!top) {
        unmatched.push({ ...close, reason: "unmatched-close" });
        continue;
      }
      if (OPEN_TO_CLOSE[top.char] !== tok.value) {
        // Mismatched kind. Treat the close as erroneous but keep the stack so a
        // later correct closer can still pair with `top`.
        unmatched.push({ ...close, reason: "mismatch", expected: OPEN_TO_CLOSE[top.char] });
        continue;
      }
      stack.pop();
      pairs.push({ open: top, close, depth: stack.length });
    }
  }

  for (const open of stack) unmatched.push({ ...open, reason: "unmatched-open" });

  pairs.sort((a, b) => a.open.from - b.open.from);
  unmatched.sort((a, b) => a.from - b.from);
  return { pairs, unmatched };
}

/**
 * The offset of the bracket partner for a bracket at `offset`, or null if the
 * position is not on a matched bracket. Enables jump-to-match / bracket
 * highlighting.
 */
export function matchingBracket(source: string, languageId: string, offset: number): number | null {
  const { pairs } = computeBracketPairs(source, languageId);
  for (const p of pairs) {
    if (offset >= p.open.from && offset < p.open.to) return p.close.from;
    if (offset >= p.close.from && offset < p.close.to) return p.open.from;
  }
  return null;
}

/** Nesting depth (number of enclosing pairs) at a given offset. */
export function bracketDepthAt(analysis: BracketAnalysis, offset: number): number {
  let depth = 0;
  for (const p of analysis.pairs) {
    if (offset > p.open.from && offset < p.close.from) depth += 1;
  }
  return depth;
}
