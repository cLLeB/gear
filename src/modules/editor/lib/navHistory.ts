// Cursor navigation history across files (VS Code's Go Back / Go Forward):
// big jumps within a file and switches between files are recorded.

import { EditorView } from "@codemirror/view";
import { app } from "@/app/appBridge";
import { getActiveEditor } from "./activeEditor";

export interface NavEntry {
  path: string;
  line: number;
}

const MAX = 100;
const JUMP_LINES = 10;
let back: NavEntry[] = [];
let forward: NavEntry[] = [];
let navigating = false;
let last: NavEntry | null = null;

/** Pure core, exported for tests: record moving from `prev` to `next`. */
export function shouldRecord(prev: NavEntry | null, next: NavEntry): boolean {
  if (!prev) return false;
  return prev.path !== next.path || Math.abs(prev.line - next.line) >= JUMP_LINES;
}

function record(next: NavEntry): void {
  if (navigating) {
    last = next;
    return;
  }
  if (last && shouldRecord(last, next)) {
    back.push(last);
    if (back.length > MAX) back.shift();
    forward = [];
  }
  last = next;
}

/** Editor extension: feeds the history from selection changes and focus. */
export function navigationTracker(getPath: () => string | undefined) {
  const note = (view: EditorView) => {
    const path = getPath();
    if (!path) return;
    record({ path, line: view.state.doc.lineAt(view.state.selection.main.head).number });
  };
  return [
    EditorView.updateListener.of((u) => {
      if (u.selectionSet && u.view.hasFocus) note(u.view);
    }),
    EditorView.domEventHandlers({
      focus: (_e, view) => {
        note(view);
        return false;
      },
    }),
  ];
}

function go(to: NavEntry): void {
  navigating = true;
  const ed = getActiveEditor();
  if (ed?.path === to.path) {
    const line = ed.view.state.doc.line(Math.min(to.line, ed.view.state.doc.lines));
    ed.view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
    ed.view.focus();
  } else app().openFile(to.path, to.line);
  last = to;
  setTimeout(() => (navigating = false), 300);
}

export function goBack(): boolean {
  const to = back.pop();
  if (!to) return false;
  if (last) forward.push(last);
  go(to);
  return true;
}

export function goForward(): boolean {
  const to = forward.pop();
  if (!to) return false;
  if (last) back.push(last);
  go(to);
  return true;
}

export function navHistoryList(): { back: readonly NavEntry[]; forward: readonly NavEntry[] } {
  return { back, forward };
}
