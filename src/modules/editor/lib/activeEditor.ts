// A registry of the most recently focused code editor. The command palette and
// other chrome live outside CodeMirror, but many actions ("Expand selection",
// "Convert to snake_case", "Find duplicate code") operate on the editor the user
// was just in. Opening the palette blurs the editor, so we deliberately track the
// *last focused* view rather than the currently focused one, and only forget it
// when that view unmounts. This lets any UI surface reach the active editor and
// its analyzable language id.

import type { EditorView } from "@codemirror/view";

export interface ActiveEditor {
  view: EditorView;
  /** Analyzable language id (e.g. "javascript"), as used by src/lib/lang. */
  languageId: string;
}

let active: ActiveEditor | null = null;

/** Record the editor the user is working in (called on focus). */
export function setActiveEditor(view: EditorView, languageId: string): void {
  active = { view, languageId };
}

/** Forget an editor when it unmounts, if it was the active one. */
export function clearActiveEditor(view: EditorView): void {
  if (active?.view === view) active = null;
}

/** The most recently focused editor, or null if none is available. */
export function getActiveEditor(): ActiveEditor | null {
  if (active && !active.view.dom.isConnected) {
    active = null; // the view was torn down without a clear
  }
  return active;
}
