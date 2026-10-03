// Line bookmarks for the editor. Bookmarks live in a CodeMirror state field
// as a RangeSet so they move with edits, render in their own gutter, and are
// persisted per file path so they survive closing the tab and restarting.

import { type EditorState, RangeSet, StateEffect, StateField, type Transaction } from "@codemirror/state";
import { EditorView, gutter, GutterMarker, type KeyBinding } from "@codemirror/view";

// ------------------------------------------------------------- persistence

const STORAGE_KEY = "gear.editorBookmarks";
type Store = Record<string, { lines: number[]; previews: string[] }>;

function readStore(): Store {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Non-essential.
  }
}

export interface StoredBookmark {
  path: string;
  line: number; // 1-based
  preview: string;
}

export function allStoredBookmarks(): StoredBookmark[] {
  const store = readStore();
  return Object.entries(store).flatMap(([path, v]) =>
    v.lines.map((line, i) => ({ path, line, preview: v.previews[i] ?? "" })),
  );
}

export function clearAllStoredBookmarks(): void {
  writeStore({});
}

function persist(path: string, state: EditorState): void {
  const lines = bookmarkLines(state);
  const store = readStore();
  if (lines.length === 0) delete store[path];
  else store[path] = { lines, previews: lines.map((n) => state.doc.line(n).text.trim().slice(0, 120)) };
  writeStore(store);
}

// --------------------------------------------------------------- state

class BookmarkMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-bookmark-marker";
    el.textContent = "◆";
    el.title = "Bookmark";
    return el;
  }
}
const marker = new BookmarkMarker();

export const toggleBookmarkEffect = StateEffect.define<number>(); // a line start position
export const setBookmarksEffect = StateEffect.define<number[]>(); // line start positions
const clearBookmarksEffect = StateEffect.define<null>();

export const bookmarkField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr: Transaction) {
    set = set.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(toggleBookmarkEffect)) {
        let exists = false;
        set.between(e.value, e.value, () => {
          exists = true;
        });
        set = exists
          ? set.update({ filter: (from) => from !== e.value })
          : set.update({ add: [marker.range(e.value)], sort: true });
      } else if (e.is(setBookmarksEffect)) {
        set = RangeSet.of(e.value.map((p) => marker.range(p)), true);
      } else if (e.is(clearBookmarksEffect)) {
        set = RangeSet.empty;
      }
    }
    return dedupeByLine(set, tr.state);
  },
});

/** Edits can collapse two bookmarked lines into one; keep a single marker. */
function dedupeByLine(set: RangeSet<GutterMarker>, state: EditorState): RangeSet<GutterMarker> {
  const seen = new Set<number>();
  let dup = false;
  set.between(0, state.doc.length, (from) => {
    const n = state.doc.lineAt(from).number;
    if (seen.has(n)) dup = true;
    seen.add(n);
  });
  if (!dup) return set;
  const lines = [...seen].sort((a, b) => a - b);
  return RangeSet.of(lines.map((n) => marker.range(state.doc.line(n).from)), true);
}

export function bookmarkLines(state: EditorState): number[] {
  const lines: number[] = [];
  state.field(bookmarkField, false)?.between(0, state.doc.length, (from) => {
    lines.push(state.doc.lineAt(from).number);
  });
  return [...new Set(lines)].sort((a, b) => a - b);
}

// ------------------------------------------------------------ commands

export function toggleBookmark(view: EditorView): boolean {
  const effects = [...new Set(view.state.selection.ranges.map((r) => view.state.doc.lineAt(r.head).from))].map((p) =>
    toggleBookmarkEffect.of(p),
  );
  view.dispatch({ effects });
  return true;
}

/** Next/previous bookmarked line after/before the cursor, wrapping around. */
export function adjacentBookmark(lines: readonly number[], current: number, dir: 1 | -1): number | null {
  if (lines.length === 0) return null;
  if (dir > 0) return lines.find((l) => l > current) ?? lines[0];
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i] < current) return lines[i];
  return lines[lines.length - 1];
}

export function gotoBookmark(view: EditorView, dir: 1 | -1): boolean {
  const current = view.state.doc.lineAt(view.state.selection.main.head).number;
  const target = adjacentBookmark(bookmarkLines(view.state), current, dir);
  if (target === null) return false;
  const pos = view.state.doc.line(target).from;
  view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
  return true;
}

export function clearBookmarks(view: EditorView): boolean {
  view.dispatch({ effects: clearBookmarksEffect.of(null) });
  return true;
}

export function bookmarksKeymap(): KeyBinding[] {
  return [
    { key: "Mod-Alt-k", preventDefault: true, run: toggleBookmark },
    { key: "Mod-Alt-l", preventDefault: true, run: (v) => gotoBookmark(v, 1) },
    { key: "Mod-Alt-j", preventDefault: true, run: (v) => gotoBookmark(v, -1) },
  ];
}

const bookmarkTheme = EditorView.baseTheme({
  ".cm-bookmark-gutter": { width: "0.9em" },
  ".cm-bookmark-marker": { color: "var(--color-primary, #3b82f6)", fontSize: "0.75em", paddingLeft: "2px" },
});

/**
 * The bookmark extension for a file. Bookmarks are restored when the editor
 * opens and written back (debounced) whenever they change.
 */
export function bookmarks(getPath: () => string | null) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return [
    bookmarkField,
    gutter({
      class: "cm-bookmark-gutter",
      markers: (v) => v.state.field(bookmarkField),
      initialSpacer: () => marker,
    }),
    bookmarkTheme,
    EditorView.updateListener.of((u) => {
      const path = getPath();
      if (!path) return;
      const before = u.startState.field(bookmarkField, false);
      const after = u.state.field(bookmarkField, false);
      if (before === after && !u.docChanged) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => persist(path, u.state), 400);
    }),
  ];
}

/** Positions to restore for `path` in `state` (lines past the end are dropped). */
export function restoredBookmarks(path: string, state: EditorState): number[] {
  const entry = readStore()[path];
  if (!entry) return [];
  return entry.lines.filter((n) => n >= 1 && n <= state.doc.lines).map((n) => state.doc.line(n).from);
}
