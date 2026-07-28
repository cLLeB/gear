// A structural, language-agnostic re-indenter. Rather than a per-language
// pretty-printer (which needs a full grammar), it derives each line's indent
// from the real structural bracket depth reported by the shared lexer — so
// braces inside strings, comments, and template literals never shift
// indentation. Lines that begin with a closing bracket are dedented one level so
// `}` aligns with its opener, the interiors of multi-line strings and block
// comments are left byte-for-byte untouched, and trailing whitespace is
// stripped. The result is a minimal WorkspaceEdit that only rewrites lines whose
// indentation actually changed.

import { getLanguageSpec } from "./languages";
import { tokenize, type Token } from "./lexer";
import { applyWorkspaceEdit, type TextEdit, type WorkspaceEdit } from "./rename";

export interface FormatOptions {
  /** Number of spaces per indent level (ignored when `useTabs`). Default 2. */
  indentSize?: number;
  /** Indent with tabs instead of spaces. Default false. */
  useTabs?: boolean;
}

const CLOSERS = new Set([")", "]", "}"]);

interface LineInfo {
  start: number;
  end: number;
  text: string;
}

function computeLines(source: string): LineInfo[] {
  const out: LineInfo[] = [];
  let start = 0;
  for (let i = 0; i <= source.length; i++) {
    if (i === source.length || source[i] === "\n") {
      out.push({ start, end: i, text: source.slice(start, i).replace(/\r$/, "") });
      start = i + 1;
    }
  }
  // A trailing newline produces a final empty "line" we don't want to duplicate.
  if (source.endsWith("\n")) out.pop();
  return out;
}

/** Lines whose first character lies inside a multi-line string/comment token. */
function rawLineSet(tokens: Token[], lineStarts: number[]): Set<number> {
  const raw = new Set<number>();
  const lineOf = (offset: number): number => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
  for (const t of tokens) {
    if (t.type !== "string" && t.type !== "comment") continue;
    const startLine = lineOf(t.start);
    const endLine = lineOf(Math.max(t.start, t.end - 1));
    for (let l = startLine + 1; l <= endLine; l++) raw.add(l);
  }
  return raw;
}

/** Compute a WorkspaceEdit that re-indents the document. */
export function formatDocument(source: string, languageId: string, options: FormatOptions = {}): WorkspaceEdit {
  const spec = getLanguageSpec(languageId);
  if (!spec) return { edits: [] };
  const { indentSize = 2, useTabs = false } = options;
  const unit = useTabs ? "\t" : " ".repeat(indentSize);

  const tokens = tokenize(source, spec.lexer);
  const lines = computeLines(source);
  const lineStarts = lines.map((l) => l.start);
  const raw = rawLineSet(tokens, lineStarts);

  // Depth at each line start = (opens before it) - (closes before it).
  // Also record the first structural token per line for the leading-close dedent.
  const opensBefore: number[] = new Array(lines.length).fill(0);
  const firstBracketOnLine: Array<"open" | "close" | null> = new Array(lines.length).fill(null);

  let depth = 0;
  let li = 0;
  for (const tok of tokens) {
    // Advance the line cursor and snapshot depth at each newly entered line.
    while (li < lines.length && lines[li].start <= tok.start) {
      opensBefore[li] = depth;
      li += 1;
    }
    const lineIndex = li - 1;
    if (lineIndex >= 0 && firstBracketOnLine[lineIndex] === null && tok.bracket) {
      firstBracketOnLine[lineIndex] = tok.bracket;
    }
    if (tok.bracket === "open") depth += 1;
    else if (tok.bracket === "close") depth = Math.max(0, depth - 1);
  }
  while (li < lines.length) { opensBefore[li] = depth; li += 1; }

  const edits: TextEdit[] = [];
  for (let l = 0; l < lines.length; l++) {
    const line = lines[l];
    if (raw.has(l)) continue; // never touch the interior of a multi-line literal

    const content = line.text.trim();
    let level = opensBefore[l];
    if (content && firstBracketOnLine[l] === "close" && CLOSERS.has(content[0])) level = Math.max(0, level - 1);

    const newText = content === "" ? "" : unit.repeat(level) + content;
    if (newText !== line.text) {
      edits.push({ from: line.start, to: line.end, insert: newText });
    }
  }
  return { edits };
}

/** Convenience: return the fully re-indented source string. */
export function formatToString(source: string, languageId: string, options?: FormatOptions): string {
  return applyWorkspaceEdit(source, formatDocument(source, languageId, options));
}
