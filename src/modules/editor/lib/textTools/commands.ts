// Editor text tools exposed as CodeMirror commands, palette actions ("Text"
// group) and keybindings. Pure logic lives in sibling modules; this file
// only maps it onto selections.

import { EditorSelection, type EditorState, type SelectionRange } from "@codemirror/state";
import type { EditorView, KeyBinding } from "@codemirror/view";
import type { CodeActionDescriptor } from "../codeActions";
import { incrementAt } from "./increment";
import { cycleToken, tokenAt } from "./cycleWord";

type RangeEdit = { from: number; to: number; insert: string; select?: "all" | "end" };

/**
 * Apply an edit per selection range (multi-cursor aware). Ranges whose
 * function returns null are left alone; returns false if nothing changed.
 */
export function editEachRange(
  view: EditorView,
  fn: (range: SelectionRange, state: EditorState) => RangeEdit | null,
): boolean {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const edit = fn(range, state);
    if (!edit) return { range };
    const end = edit.from + edit.insert.length;
    const next =
      edit.select === "all"
        ? EditorSelection.range(edit.from, end)
        : edit.select === "end"
          ? EditorSelection.cursor(end)
          : range.empty
            ? EditorSelection.cursor(end) // like Vim: cursor lands on the edited token's end
            : EditorSelection.range(edit.from, end);
    return {
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      range: next,
    };
  });
  if (tr.changes.empty) return false;
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input" }));
  return true;
}

export function incrementCmd(delta: number) {
  return (view: EditorView): boolean =>
    editEachRange(view, (range, state) => {
      const line = state.doc.lineAt(range.head);
      const hit = incrementAt(line.text, range.head - line.from, delta);
      if (!hit) return null;
      return { from: line.from + hit.from, to: line.from + hit.to, insert: hit.text, select: range.empty ? undefined : "all" };
    });
}

export function cycleWordCmd(direction: 1 | -1) {
  return (view: EditorView): boolean =>
    editEachRange(view, (range, state) => {
      const line = state.doc.lineAt(range.head);
      const tok = range.empty
        ? tokenAt(line.text, range.head - line.from)
        : range.from >= line.from && range.to <= line.to
          ? { from: range.from - line.from, to: range.to - line.from, text: state.sliceDoc(range.from, range.to) }
          : null;
      if (!tok) return null;
      const next = cycleToken(tok.text, direction);
      if (next === null) return null;
      return { from: line.from + tok.from, to: line.from + tok.to, insert: next, select: range.empty ? "end" : "all" };
    });
}

export const TEXT_ACTIONS: CodeActionDescriptor[] = [
  { id: "text.cycleWord", label: "Toggle word (true/false, let/const, ===/!==…)", keywords: ["cycle", "toggle", "boolean", "flip", "opposite", "switch"], run: (v) => cycleWordCmd(1)(v) },
  { id: "text.cycleWordBack", label: "Toggle word backwards", keywords: ["cycle", "toggle", "previous"], run: (v) => cycleWordCmd(-1)(v) },
  { id: "text.increment", label: "Increment number", keywords: ["increase", "plus", "ctrl-a", "counter", "date"], run: (v) => incrementCmd(1)(v) },
  { id: "text.decrement", label: "Decrement number", keywords: ["decrease", "minus", "ctrl-x", "counter", "date"], run: (v) => incrementCmd(-1)(v) },
  { id: "text.increment10", label: "Increment number by 10", keywords: ["increase", "plus", "ten"], run: (v) => incrementCmd(10)(v) },
  { id: "text.decrement10", label: "Decrement number by 10", keywords: ["decrease", "minus", "ten"], run: (v) => incrementCmd(-10)(v) },
];

export function textToolsKeymap(): KeyBinding[] {
  return [
    { key: "Mod-Alt-=", preventDefault: true, run: incrementCmd(1) },
    { key: "Mod-Alt--", preventDefault: true, run: incrementCmd(-1) },
    { key: "Mod-Alt-t", preventDefault: true, run: cycleWordCmd(1) },
    { key: "Mod-Alt-Shift-t", preventDefault: true, run: cycleWordCmd(-1) },
  ];
}
