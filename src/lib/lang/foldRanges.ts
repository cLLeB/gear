// Computes foldable regions for a document independent of any editor: nested
// brace blocks, indentation blocks (Python), runs of consecutive line comments,
// multi-line block comments, and explicit #region / #endregion markers. Line
// numbers are 1-based; a range folds from the end of `startLine` through
// `endLine`.

import { getLanguageSpec } from "./languages";
import { tokenize, type Token } from "./lexer";
import { PositionMapper } from "./position";

export type FoldKind = "block" | "comment" | "region";

export interface FoldRange {
  startLine: number;
  endLine: number;
  kind: FoldKind;
}

const REGION_START = /(?:#region|#pragma\s+region|\/\/\s*#region|<editor-fold)/i;
const REGION_END = /(?:#endregion|#pragma\s+endregion|\/\/\s*#endregion|<\/editor-fold)/i;

/** Compute all fold ranges for a source document. */
export function computeFoldRanges(source: string, languageId: string): FoldRange[] {
  const spec = getLanguageSpec(languageId);
  const positions = new PositionMapper(source);
  const ranges: FoldRange[] = [];

  if (spec) {
    const tokens = tokenize(source, spec.lexer);
    if (spec.braceBlocks) foldBraces(tokens, positions, ranges);
    else foldIndentation(source, positions, ranges);
    foldComments(tokens, positions, ranges);
  } else {
    foldIndentation(source, positions, ranges);
  }

  foldRegions(positions, ranges);

  // De-duplicate and sort by start line, then widest first.
  const seen = new Set<string>();
  return ranges
    .filter((r) => r.endLine > r.startLine)
    .filter((r) => {
      const key = `${r.startLine}:${r.endLine}:${r.kind}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
}

function foldBraces(tokens: Token[], positions: PositionMapper, out: FoldRange[]): void {
  const stack: number[] = [];
  for (const token of tokens) {
    if (token.value === "{") stack.push(token.start);
    else if (token.value === "}") {
      const openOffset = stack.pop();
      if (openOffset === undefined) continue;
      const startLine = positions.positionAt(openOffset).line;
      const endLine = positions.positionAt(token.start).line;
      if (endLine > startLine) out.push({ startLine, endLine, kind: "block" });
    }
  }
}

function foldIndentation(source: string, positions: PositionMapper, out: FoldRange[]): void {
  const lines = source.split("\n");
  const indentOf = (l: string) => (l.trim() === "" ? -1 : /^[ \t]*/.exec(l)![0].replace(/\t/g, "    ").length);

  for (let i = 0; i < lines.length; i++) {
    const indent = indentOf(lines[i]);
    if (indent < 0) continue;
    let j = i + 1;
    let last = i;
    for (; j < lines.length; j++) {
      const childIndent = indentOf(lines[j]);
      if (childIndent < 0) continue; // blank lines belong to the block
      if (childIndent <= indent) break;
      last = j;
    }
    if (last > i) out.push({ startLine: i + 1, endLine: last + 1, kind: "block" });
  }
}

function foldComments(tokens: Token[], positions: PositionMapper, out: FoldRange[]): void {
  // Multi-line block comments.
  for (const token of tokens) {
    if (token.type !== "comment") continue;
    const startLine = positions.positionAt(token.start).line;
    const endLine = positions.positionAt(Math.max(token.start, token.end - 1)).line;
    if (endLine > startLine) out.push({ startLine, endLine, kind: "comment" });
  }

  // Runs of consecutive single-line comments.
  const commentLines = new Set<number>();
  for (const token of tokens) {
    if (token.type !== "comment") continue;
    const s = positions.positionAt(token.start).line;
    const e = positions.positionAt(Math.max(token.start, token.end - 1)).line;
    if (s === e) commentLines.add(s);
  }
  const sorted = [...commentLines].sort((a, b) => a - b);
  let runStart = -1;
  let prev = -2;
  for (const line of sorted) {
    if (line !== prev + 1) {
      if (runStart >= 0 && prev > runStart) out.push({ startLine: runStart, endLine: prev, kind: "comment" });
      runStart = line;
    }
    prev = line;
  }
  if (runStart >= 0 && prev > runStart) out.push({ startLine: runStart, endLine: prev, kind: "comment" });
}

function foldRegions(positions: PositionMapper, out: FoldRange[]): void {
  const stack: number[] = [];
  for (let line = 1; line <= positions.lineCount; line++) {
    const text = positions.lineText(line);
    if (REGION_END.test(text)) {
      const start = stack.pop();
      if (start !== undefined && line > start) out.push({ startLine: start, endLine: line, kind: "region" });
    } else if (REGION_START.test(text)) {
      stack.push(line);
    }
  }
}
