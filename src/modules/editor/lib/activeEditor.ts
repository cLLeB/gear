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
  /** Absolute path of the file in this editor, when known. */
  path?: string;
}

let active: ActiveEditor | null = null;

/** Record the editor the user is working in (called on focus). */
export function setActiveEditor(view: EditorView, languageId: string, path?: string): void {
  const changed = active?.path !== path || active?.languageId !== languageId;
  active = { view, languageId, path };
  if (path) noteRecentFile(path);
  if (changed && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("gear:active-editor", { detail: { path, languageId } }));
}

// Most-recently-focused files, persisted per machine for "Open recent file".
const RECENT_KEY = "gear.recentFiles";
const RECENT_MAX = 60;

function noteRecentFile(path: string): void {
  try {
    const list = recentFiles().filter((p) => p !== path);
    localStorage.setItem(RECENT_KEY, JSON.stringify([path, ...list].slice(0, RECENT_MAX)));
  } catch {
    /* storage unavailable */
  }
}

export function recentFiles(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function forgetRecentFiles(): void {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    /* ignore */
  }
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
