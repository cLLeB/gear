// A lightweight control-flow analysis over the shared lexer's tokens. A true
// per-language CFG needs a full parser; this instead tracks brace depth and
// statement boundaries to answer the single most valuable control-flow question
// an editor asks — "is this code reachable?" — without a language server.
//
// The key to avoiding false positives is the guard flag: a terminator
// (return/throw/break/continue) only kills the rest of its block when it is an
// *unconditional* statement. If a branch keyword (if/for/while/else/case…)
// appeared since the last statement boundary, the terminator is conditional and
// nothing after it is dead. `switch` labels reset reachability so code after a
// `return` in one `case` does not mark the next `case` unreachable.

import { getLanguageSpec } from "./languages";
import { tokenize } from "./lexer";

export interface Range {
  from: number;
  to: number;
}

export interface BasicBlock {
  from: number;
  to: number;
  /** Terminator keyword that ends the block, if any. */
  terminator?: string;
  reachable: boolean;
}

const TERMINATORS = new Set(["return", "throw", "break", "continue", "panic", "goto", "fallthrough"]);
const BRANCH = new Set(["if", "else", "elif", "for", "while", "switch", "match", "case", "catch", "loop", "do"]);
const LABELS = new Set(["case", "default"]);

/**
 * Ranges of source that can never execute because they follow an unconditional
 * control-transfer statement within the same block.
 */
export function findUnreachableCode(source: string, languageId: string): Range[] {
  const spec = getLanguageSpec(languageId);
  if (!spec || !spec.braceBlocks) return [];
  const tokens = tokenize(source, spec.lexer);

  const ranges: Range[] = [];
  let depth = 0;
  const dead: boolean[] = [false];
  const pendingDead: boolean[] = [false];
  const branchSeen: boolean[] = [false];
  const openStart: Array<number | undefined> = [undefined];

  const closeRange = (d: number, end: number) => {
    if (openStart[d] !== undefined) {
      ranges.push({ from: openStart[d]!, to: end });
      openStart[d] = undefined;
    }
  };

  for (const tok of tokens) {
    if (tok.value === "{") {
      depth += 1;
      dead[depth] = false;
      pendingDead[depth] = false;
      branchSeen[depth] = false;
      openStart[depth] = undefined;
      continue;
    }
    if (tok.value === "}") {
      closeRange(depth, tok.start);
      depth = Math.max(0, depth - 1);
      continue;
    }

    const d = depth;

    if (tok.value === ";") {
      if (pendingDead[d]) { dead[d] = true; pendingDead[d] = false; }
      branchSeen[d] = false;
      continue;
    }

    // switch/case labels start a fresh reachable region.
    if (tok.type === "keyword" && LABELS.has(tok.value)) {
      closeRange(d, tok.start);
      dead[d] = false;
      pendingDead[d] = false;
      branchSeen[d] = false;
      continue;
    }

    // The first real statement token while dead opens an unreachable range.
    if (dead[d] && openStart[d] === undefined) {
      openStart[d] = tok.start;
    }

    if (tok.type === "keyword" && BRANCH.has(tok.value)) branchSeen[d] = true;
    if (tok.type === "keyword" && TERMINATORS.has(tok.value) && !branchSeen[d] && !dead[d]) {
      pendingDead[d] = true;
    }
  }

  // Coalesce adjacent ranges.
  ranges.sort((a, b) => a.from - b.from);
  const merged: Range[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
    else merged.push({ ...r });
  }
  return merged;
}

/**
 * Segment the top-level statements of the document into basic blocks split at
 * branch keywords and terminators, each flagged with its reachability. This is a
 * coarse model (it does not expand every edge) but is enough to visualize flow
 * and drive block-level diagnostics.
 */
export function basicBlocks(source: string, languageId: string): BasicBlock[] {
  const spec = getLanguageSpec(languageId);
  if (!spec || !spec.braceBlocks) return [];
  const tokens = tokenize(source, spec.lexer);
  const unreachable = findUnreachableCode(source, languageId);
  const isDead = (offset: number) => unreachable.some((r) => offset >= r.from && offset < r.to);

  const blocks: BasicBlock[] = [];
  let start: number | null = null;
  let terminator: string | undefined;

  const flush = (end: number) => {
    if (start === null) return;
    blocks.push({ from: start, to: end, terminator, reachable: !isDead(start) });
    start = null;
    terminator = undefined;
  };

  for (const tok of tokens) {
    if (start === null && tok.value !== "{" && tok.value !== "}" && tok.value !== ";") start = tok.start;
    if (tok.type === "keyword" && TERMINATORS.has(tok.value)) terminator = tok.value;
    if (tok.value === ";" || tok.value === "{" || tok.value === "}") flush(tok.start);
  }
  flush(source.length);
  return blocks;
}
