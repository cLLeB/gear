// Editor commands that expose the src/lib/lang toolkit as real, user-facing
// actions. Each function is a CodeMirror command (operates on an EditorView) and
// is also listed in CODE_ACTIONS so the command palette can offer the same
// operations by name. Transform actions edit the buffer; analysis actions report
// a summary via a toast. Everything runs in-process against the current document
// and its detected language — no language server required.

import { EditorSelection, type EditorState } from "@codemirror/state";
import type { EditorView, KeyBinding } from "@codemirror/view";
import { toast } from "sonner";

import { expandSelection, shrinkSelection } from "@/lib/lang/smartSelect";
import { expandEmmet } from "@/lib/lang/emmet";
import { convertCase, type CaseStyle } from "@/lib/lang/caseTransform";
import { findClones } from "@/lib/lang/cloneDetection";
import { deadStores } from "@/lib/lang/dataflow";
import { analyzeComplexity } from "@/lib/lang/complexity";
import { parseJson5 } from "@/lib/lang/json5";
import {
  isNoop,
  joinLines,
  removeBlankLines,
  reverseLines,
  sortLines,
  sortLinesIgnoreCase,
  trimTrailingWhitespace,
  uniqueLines,
} from "./lineOps";

import { getActiveEditor } from "./activeEditor";

// --- selection helpers -----------------------------------------------------

/** The word (or existing selection) around the main cursor. */
function mainWordRange(state: EditorState): { from: number; to: number } {
  const sel = state.selection.main;
  if (!sel.empty) return { from: sel.from, to: sel.to };
  const word = state.wordAt(sel.head);
  return word ? { from: word.from, to: word.to } : { from: sel.from, to: sel.to };
}

function replaceRange(view: EditorView, from: number, to: number, text: string): void {
  view.dispatch({
    changes: { from, to, insert: text },
    selection: EditorSelection.range(from, from + text.length),
  });
  view.focus();
}

// --- selection actions -----------------------------------------------------

export function expandSelectionCmd(view: EditorView, languageId: string): boolean {
  const doc = view.state.doc.toString();
  const sel = view.state.selection.main;
  const next = expandSelection(doc, languageId, { from: sel.from, to: sel.to });
  if (next.from === sel.from && next.to === sel.to) return false;
  view.dispatch({ selection: EditorSelection.range(next.from, next.to) });
  return true;
}

export function shrinkSelectionCmd(view: EditorView, languageId: string): boolean {
  const doc = view.state.doc.toString();
  const sel = view.state.selection.main;
  const next = shrinkSelection(doc, languageId, { from: sel.from, to: sel.to });
  view.dispatch({ selection: EditorSelection.range(next.from, next.to) });
  return true;
}

// --- transform actions -----------------------------------------------------

function caseAction(style: CaseStyle) {
  return (view: EditorView): boolean => {
    const { from, to } = mainWordRange(view.state);
    if (from === to) return false;
    const text = view.state.sliceDoc(from, to);
    replaceRange(view, from, to, convertCase(text, style));
    return true;
  };
}

export const toCamelCase = caseAction("camel");
export const toPascalCase = caseAction("pascal");
export const toSnakeCase = caseAction("snake");
export const toKebabCase = caseAction("kebab");
export const toConstantCase = caseAction("screamingSnake");

export function expandEmmetCmd(view: EditorView): boolean {
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.head);
  const abbreviation = line.text.trim();
  if (abbreviation === "") return false;
  let html: string;
  try {
    html = expandEmmet(abbreviation);
  } catch {
    return false;
  }
  if (html === "" || html === abbreviation) return false;
  const indent = line.text.slice(0, line.text.length - line.text.trimStart().length);
  const indented = html.split("\n").map((l, i) => (i === 0 ? l : indent + l)).join("\n");
  replaceRange(view, line.from + indent.length, line.to, indented);
  return true;
}

// --- line actions ----------------------------------------------------------

/**
 * Applies a transform to the lines the selection touches, or to the whole
 * document when nothing is selected — the latter is what makes "trim trailing
 * whitespace" and "remove blank lines" useful as one-shot cleanups.
 *
 * The rewritten range is left selected so a follow-up action can chain onto it.
 */
function transformLines(
  view: EditorView,
  transform: (lines: string[]) => string[],
): boolean {
  const sel = view.state.selection.main;
  const doc = view.state.doc;
  const wholeDoc = sel.empty;
  const startLine = wholeDoc ? doc.line(1) : doc.lineAt(sel.from);
  const endLine = wholeDoc ? doc.line(doc.lines) : doc.lineAt(sel.to);

  const lines: string[] = [];
  for (let n = startLine.number; n <= endLine.number; n++) {
    lines.push(doc.line(n).text);
  }

  const next = transform(lines);
  if (isNoop(lines, next)) return false;

  const insert = next.join("\n");
  view.dispatch({
    changes: { from: startLine.from, to: endLine.to, insert },
    selection: EditorSelection.range(startLine.from, startLine.from + insert.length),
  });
  view.focus();
  return true;
}

export function sortLinesCmd(view: EditorView): boolean {
  return transformLines(view, (lines) => sortLines(lines, "asc"));
}

export function sortLinesDescCmd(view: EditorView): boolean {
  return transformLines(view, (lines) => sortLines(lines, "desc"));
}

export function sortLinesIgnoreCaseCmd(view: EditorView): boolean {
  return transformLines(view, (lines) => sortLinesIgnoreCase(lines, "asc"));
}

export function uniqueLinesCmd(view: EditorView): boolean {
  return transformLines(view, uniqueLines);
}

export function reverseLinesCmd(view: EditorView): boolean {
  return transformLines(view, reverseLines);
}

export function trimTrailingWhitespaceCmd(view: EditorView): boolean {
  return transformLines(view, trimTrailingWhitespace);
}

export function removeBlankLinesCmd(view: EditorView): boolean {
  return transformLines(view, removeBlankLines);
}

export function joinLinesCmd(view: EditorView): boolean {
  return transformLines(view, (lines) => joinLines(lines));
}

function reformatJson(view: EditorView, minify: boolean): boolean {
  const doc = view.state.doc.toString();
  try {
    const value = parseJson5(doc);
    const formatted = minify ? JSON.stringify(value) : JSON.stringify(value, null, 2);
    view.dispatch({ changes: { from: 0, to: doc.length, insert: formatted } });
    view.focus();
    return true;
  } catch (e) {
    toast.error("Not valid JSON", { description: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

export const formatJsonCmd = (view: EditorView) => reformatJson(view, false);
export const minifyJsonCmd = (view: EditorView) => reformatJson(view, true);

// --- analysis actions (report via toast) -----------------------------------

/** Run an analysis, surfacing any unexpected failure as a toast rather than throwing. */
function guardAnalysis(label: string, fn: () => void): boolean {
  try {
    fn();
    return true;
  } catch (e) {
    toast.error(`${label} failed`, { description: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

export function findClonesCmd(view: EditorView, languageId: string): boolean {
  return guardAnalysis("Find duplicate code", () => {
    const clones = findClones(view.state.doc.toString(), languageId, { minTokens: 20 });
    if (clones.length === 0) {
      toast.success("No duplicate code blocks found");
      return;
    }
    const first = clones[0];
    const line = (offset: number) => view.state.doc.lineAt(offset).number;
    toast.warning(`${clones.length} duplicate block${clones.length > 1 ? "s" : ""} found`, {
      description: `Largest: lines ${line(first.a.from)} and ${line(first.b.from)} (${first.tokenLength} tokens)`,
    });
    view.dispatch({ selection: EditorSelection.range(first.a.from, first.a.to), scrollIntoView: true });
  });
}

export function deadStoresCmd(view: EditorView, languageId: string): boolean {
  return guardAnalysis("Detect dead stores", () => {
    const stores = deadStores(view.state.doc.toString(), languageId);
    if (stores.length === 0) {
      toast.success("No dead stores found");
      return;
    }
    const names = [...new Set(stores.map((s) => s.name))].slice(0, 5).join(", ");
    toast.warning(`${stores.length} dead store${stores.length > 1 ? "s" : ""}`, {
      description: `Assigned but never read: ${names}`,
    });
    view.dispatch({ selection: EditorSelection.range(stores[0].from, stores[0].to), scrollIntoView: true });
  });
}

export function codeMetricsCmd(view: EditorView, languageId: string): boolean {
  return guardAnalysis("Show code metrics", () => {
    const report = analyzeComplexity(view.state.doc.toString(), languageId);
    const worst = [...report.functions].sort((a, b) => b.complexity - a.complexity)[0];
    toast.info(`Complexity ${report.fileComplexity} · ${report.metrics.sloc} SLOC`, {
      description: worst
        ? `Most complex: ${worst.name} (${worst.complexity}) · comment ratio ${(report.metrics.commentRatio * 100).toFixed(0)}%`
        : `Max nesting depth ${report.metrics.maxDepth}`,
    });
  });
}

// --- palette-facing catalog ------------------------------------------------

export interface CodeActionDescriptor {
  id: string;
  label: string;
  keywords: string[];
  /** True when the action only makes sense for JSON documents. */
  jsonOnly?: boolean;
  run: (view: EditorView, languageId: string) => void;
}

export const CODE_ACTIONS: CodeActionDescriptor[] = [
  { id: "code.expandSelection", label: "Expand selection", keywords: ["select", "grow", "semantic"], run: expandSelectionCmd },
  { id: "code.shrinkSelection", label: "Shrink selection", keywords: ["select", "shrink", "semantic"], run: shrinkSelectionCmd },
  { id: "code.toCamelCase", label: "Convert to camelCase", keywords: ["case", "rename", "identifier"], run: (v) => toCamelCase(v) },
  { id: "code.toPascalCase", label: "Convert to PascalCase", keywords: ["case", "rename", "identifier"], run: (v) => toPascalCase(v) },
  { id: "code.toSnakeCase", label: "Convert to snake_case", keywords: ["case", "rename", "identifier"], run: (v) => toSnakeCase(v) },
  { id: "code.toKebabCase", label: "Convert to kebab-case", keywords: ["case", "rename", "identifier"], run: (v) => toKebabCase(v) },
  { id: "code.toConstantCase", label: "Convert to CONSTANT_CASE", keywords: ["case", "rename", "identifier", "screaming"], run: (v) => toConstantCase(v) },
  { id: "code.expandEmmet", label: "Expand Emmet abbreviation", keywords: ["emmet", "html", "expand"], run: (v) => expandEmmetCmd(v) },
  { id: "code.sortLines", label: "Sort lines", keywords: ["sort", "lines", "alphabetical", "ascending"], run: (v) => sortLinesCmd(v) },
  { id: "code.sortLinesDesc", label: "Sort lines descending", keywords: ["sort", "lines", "reverse", "descending"], run: (v) => sortLinesDescCmd(v) },
  { id: "code.sortLinesIgnoreCase", label: "Sort lines ignoring case", keywords: ["sort", "lines", "case", "insensitive"], run: (v) => sortLinesIgnoreCaseCmd(v) },
  { id: "code.uniqueLines", label: "Remove duplicate lines", keywords: ["unique", "dedupe", "duplicate", "lines"], run: (v) => uniqueLinesCmd(v) },
  { id: "code.reverseLines", label: "Reverse lines", keywords: ["reverse", "flip", "lines", "order"], run: (v) => reverseLinesCmd(v) },
  { id: "code.trimTrailingWhitespace", label: "Trim trailing whitespace", keywords: ["trim", "whitespace", "trailing", "clean"], run: (v) => trimTrailingWhitespaceCmd(v) },
  { id: "code.removeBlankLines", label: "Remove blank lines", keywords: ["blank", "empty", "lines", "clean"], run: (v) => removeBlankLinesCmd(v) },
  { id: "code.joinLines", label: "Join lines", keywords: ["join", "merge", "lines", "single"], run: (v) => joinLinesCmd(v) },
  { id: "code.formatJson", label: "Format JSON", keywords: ["json", "pretty", "beautify"], jsonOnly: true, run: (v) => formatJsonCmd(v) },
  { id: "code.minifyJson", label: "Minify JSON", keywords: ["json", "compact"], jsonOnly: true, run: (v) => minifyJsonCmd(v) },
  { id: "code.findClones", label: "Find duplicate code", keywords: ["clone", "duplicate", "copy paste"], run: findClonesCmd },
  { id: "code.deadStores", label: "Detect dead stores", keywords: ["dataflow", "unused", "dead", "assignment"], run: deadStoresCmd },
  { id: "code.metrics", label: "Show code metrics", keywords: ["complexity", "metrics", "cyclomatic", "sloc"], run: codeMetricsCmd },
];

/** Keybindings for the highest-frequency editor actions. */
export function codeActionsKeymap(getLanguageId: () => string): KeyBinding[] {
  return [
    { key: "Shift-Alt-ArrowRight", preventDefault: true, run: (view) => expandSelectionCmd(view, getLanguageId()) },
    { key: "Shift-Alt-ArrowLeft", preventDefault: true, run: (view) => shrinkSelectionCmd(view, getLanguageId()) },
  ];
}

/** Run a code action against the last-focused editor; toasts if none is active. */
export function runCodeActionOnActiveEditor(descriptor: CodeActionDescriptor): void {
  const active = getActiveEditor();
  if (!active) {
    toast.error("Open a file in the editor first");
    return;
  }
  descriptor.run(active.view, active.languageId);
}
