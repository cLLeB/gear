// Smart "expand / shrink selection" (a.k.a. semantic selection ranges). Given a
// cursor offset it produces a chain of nested ranges that grow outward through
// the natural structure of the code: the word under the cursor, the contents of
// the enclosing string, the string itself, the inside of each enclosing bracket
// pair, the pair including its brackets, the current line, and finally the whole
// document. Each range strictly contains the previous one, so an editor can bind
// "expand selection" to step outward and "shrink selection" to step back in —
// the single most-used structural-editing gesture, with no language server.

import { computeBracketPairs } from "./bracketPairs";
import { getLanguageSpec } from "./languages";
import { tokenize } from "./lexer";

export interface Range {
  from: number;
  to: number;
}

function size(r: Range): number {
  return r.to - r.from;
}

function contains(outer: Range, inner: Range): boolean {
  return outer.from <= inner.from && outer.to >= inner.to;
}

function strictlyContains(outer: Range, inner: Range): boolean {
  return contains(outer, inner) && size(outer) > size(inner);
}

/**
 * The full chain of nested selection ranges around `offset`, smallest first.
 * Every range contains `offset`, and each range strictly contains all earlier
 * ones. Always ends with the whole-document range.
 */
export function selectionRanges(source: string, languageId: string, offset: number): Range[] {
  const pos = Math.max(0, Math.min(offset, source.length));
  const candidates: Range[] = [];

  const spec = getLanguageSpec(languageId);
  if (spec) {
    const toks = tokenize(source, spec.lexer);
    // Half-open membership: a cursor sitting between `(` and `bar` selects the
    // word, not the empty bracket. Fall back to a token that *ends* at the cursor
    // only when nothing else covers it (e.g. cursor at end of the last token).
    let onToken = toks.filter((tok) => pos >= tok.start && pos < tok.end);
    if (onToken.length === 0) onToken = toks.filter((tok) => pos === tok.end);
    for (const tok of onToken) {
      candidates.push({ from: tok.start, to: tok.end });
      // For a string/comment, the content without delimiters is a useful stop.
      if (tok.type === "string" && tok.end - tok.start >= 2) {
        candidates.push({ from: tok.start + 1, to: tok.end - 1 });
      }
    }

    const { pairs } = computeBracketPairs(source, languageId);
    for (const p of pairs) {
      if (pos >= p.open.from && pos <= p.close.to) {
        candidates.push({ from: p.open.to, to: p.close.from }); // inside brackets
        candidates.push({ from: p.open.from, to: p.close.to }); // including brackets
      }
    }
  }

  candidates.push(lineRange(source, pos));
  candidates.push({ from: 0, to: source.length });

  return buildNestedChain(candidates, pos);
}

/** The line (without its trailing newline) containing `pos`. */
function lineRange(source: string, pos: number): Range {
  let from = pos;
  while (from > 0 && source[from - 1] !== "\n") from--;
  let to = pos;
  while (to < source.length && source[to] !== "\n") to++;
  return { from, to };
}

/** Reduce raw candidates to a strictly-nesting, offset-containing chain. */
function buildNestedChain(candidates: Range[], pos: number): Range[] {
  const valid = candidates.filter((r) => r.from <= pos && pos <= r.to && r.to > r.from);
  // Smallest first, deduped by identical bounds.
  valid.sort((a, b) => size(a) - size(b) || a.from - b.from);

  const chain: Range[] = [];
  for (const r of valid) {
    const last = chain[chain.length - 1];
    if (!last) { chain.push(r); continue; }
    if (r.from === last.from && r.to === last.to) continue; // duplicate
    if (strictlyContains(r, last)) chain.push(r);
  }
  return chain;
}

/**
 * The next range outward from the current `selection`. If nothing larger
 * exists (already whole-document) the selection is returned unchanged.
 */
export function expandSelection(source: string, languageId: string, selection: Range): Range {
  // Anchor at the selection's midpoint so the chain is stable under repeated
  // expand/shrink — using an endpoint can land on an enclosing bracket and skew it.
  const anchor = Math.floor((selection.from + selection.to) / 2);
  const chain = selectionRanges(source, languageId, anchor);
  for (const r of chain) {
    if (contains(r, selection) && (r.from < selection.from || r.to > selection.to)) return r;
  }
  return selection;
}

/**
 * The next range inward from the current `selection` — the largest chain range
 * strictly contained by it. Returns the selection unchanged if none is smaller.
 */
export function shrinkSelection(source: string, languageId: string, selection: Range): Range {
  const anchor = Math.floor((selection.from + selection.to) / 2);
  const chain = selectionRanges(source, languageId, anchor);
  let best: Range | null = null;
  for (const r of chain) {
    if (strictlyContains(selection, r)) {
      if (!best || size(r) > size(best)) best = r;
    }
  }
  return best ?? selection;
}
