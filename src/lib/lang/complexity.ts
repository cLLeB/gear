// Computes McCabe cyclomatic complexity per function plus whole-file code
// metrics (physical/source/comment lines, comment ratio, maximum nesting depth,
// function count). Everything is derived from the shared lexer and the symbol
// outline, so it works for every analyzable language without a compiler.

import { getLanguageSpec } from "./languages";
import { tokenize, type Token } from "./lexer";
import { PositionMapper } from "./position";
import { extractSymbols, flattenSymbols } from "./symbols";

export interface FunctionComplexity {
  name: string;
  complexity: number;
  from: number;
  to: number;
}

export interface CodeMetrics {
  /** Physical lines. */
  lines: number;
  /** Source lines of code (contain a non-comment token). */
  sloc: number;
  /** Lines that are purely comments. */
  commentLines: number;
  /** Blank lines. */
  blankLines: number;
  /** commentLines / (sloc + commentLines), 0..1. */
  commentRatio: number;
  /** Deepest brace (or indentation) nesting reached. */
  maxDepth: number;
}

export interface ComplexityReport {
  fileComplexity: number;
  functions: FunctionComplexity[];
  metrics: CodeMetrics;
}

const EXTRA_BRANCH_OPERATORS = new Set(["&&", "||", "??", "?"]);

function isBranchToken(token: Token, branchKeywords: ReadonlySet<string>): boolean {
  if (token.type === "keyword" && branchKeywords.has(token.value)) return true;
  if (token.type === "operator" && EXTRA_BRANCH_OPERATORS.has(token.value)) return true;
  if (token.type === "punctuation" && token.value === "?") return true;
  return false;
}

/** Cyclomatic complexity of a token range: decision points + 1. */
function complexityOfRange(tokens: Token[], from: number, to: number, branchKeywords: ReadonlySet<string>): number {
  let decisions = 0;
  for (const token of tokens) {
    if (token.start < from || token.end > to) continue;
    if (isBranchToken(token, branchKeywords)) decisions++;
  }
  return decisions + 1;
}

function computeMetrics(source: string, tokens: Token[], braceBlocks: boolean): CodeMetrics {
  const positions = new PositionMapper(source);
  const lineCount = positions.lineCount;
  const codeLines = new Set<number>();
  const commentOnly = new Set<number>();

  for (const token of tokens) {
    const startLine = positions.positionAt(token.start).line;
    const endLine = positions.positionAt(Math.max(token.start, token.end - 1)).line;
    for (let l = startLine; l <= endLine; l++) {
      if (token.type === "comment") commentOnly.add(l);
      else codeLines.add(l);
    }
  }

  let sloc = 0;
  let commentLines = 0;
  let blankLines = 0;
  for (let l = 1; l <= lineCount; l++) {
    const text = positions.lineText(l);
    if (text.trim() === "") { blankLines++; continue; }
    if (codeLines.has(l)) sloc++;
    else if (commentOnly.has(l)) commentLines++;
    else sloc++; // non-blank line with no token (rare) counts as code
  }

  // Max nesting depth.
  let maxDepth = 0;
  if (braceBlocks) {
    let depth = 0;
    for (const token of tokens) {
      if (token.value === "{") { depth++; maxDepth = Math.max(maxDepth, depth); }
      else if (token.value === "}") depth = Math.max(0, depth - 1);
    }
  } else {
    for (let l = 1; l <= lineCount; l++) {
      const text = positions.lineText(l);
      if (text.trim() === "") continue;
      const indent = /^[ \t]*/.exec(text)![0].replace(/\t/g, "    ").length;
      maxDepth = Math.max(maxDepth, Math.floor(indent / 4) + 1);
    }
  }

  const commentRatio = sloc + commentLines === 0 ? 0 : commentLines / (sloc + commentLines);
  return { lines: lineCount, sloc, commentLines, blankLines, commentRatio, maxDepth };
}

/** Produce a full complexity + metrics report for a source file. */
export function analyzeComplexity(source: string, languageId: string): ComplexityReport {
  const spec = getLanguageSpec(languageId);
  if (!spec) {
    return {
      fileComplexity: 1,
      functions: [],
      metrics: { lines: source.split("\n").length, sloc: 0, commentLines: 0, blankLines: 0, commentRatio: 0, maxDepth: 0 },
    };
  }

  const tokens = tokenize(source, spec.lexer);
  const symbols = flattenSymbols(extractSymbols(source, languageId)).filter(
    (s) => s.kind === "function" || s.kind === "method",
  );

  const functions: FunctionComplexity[] = symbols.map((s) => ({
    name: s.name,
    complexity: complexityOfRange(tokens, s.from, s.to, spec.branchKeywords),
    from: s.from,
    to: s.to,
  }));

  return {
    fileComplexity: complexityOfRange(tokens, 0, source.length, spec.branchKeywords),
    functions,
    metrics: computeMetrics(source, tokens, spec.braceBlocks),
  };
}
