import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { useCallback, useMemo, useRef } from "react";
import { loadViewState, saveViewState } from "./viewState";

/// How long the cursor must sit still before its position is written.
const SAVE_DEBOUNCE_MS = 400;

/**
 * Remembers where the user was in each file, so a tab restored on relaunch
 * opens at the same cursor and scroll offset instead of at line 1.
 *
 * `getPath` is read lazily rather than captured, so the returned extension is
 * stable across file switches and never forces CodeMirror to rebuild.
 */
export function useEditorViewState(getPath: () => string) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredFor = useRef<string | null>(null);

  const persist = useCallback(
    (view: EditorView) => {
      const path = getPath();
      if (!path) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        const { anchor, head } = view.state.selection.main;
        void saveViewState(path, {
          anchor,
          head,
          scrollTop: view.scrollDOM.scrollTop,
        });
      }, SAVE_DEBOUNCE_MS);
    },
    [getPath],
  );

  const extension = useMemo<Extension>(
    () => [
      EditorView.updateListener.of((u) => {
        if (u.selectionSet || u.docChanged) persist(u.view);
      }),
      // Blur is the last chance to record a position before a tab switch, and
      // it also catches scrolling that never moved the cursor.
      EditorView.domEventHandlers({
        blur: (_event, view) => {
          persist(view);
          return false;
        },
      }),
    ],
    [persist],
  );

  /** Applies the remembered position. Safe to call on every ready transition —
   *  it runs at most once per path, so it never fights the user's cursor. */
  const restore = useCallback(
    async (view: EditorView) => {
      const path = getPath();
      if (!path || restoredFor.current === path) return;
      restoredFor.current = path;

      const state = await loadViewState(path);
      // The view can be torn down or reused for another file while the store
      // read is in flight.
      if (!state || view.dom.isConnected === false || getPath() !== path) return;

      // The file may have shrunk on disk since the position was recorded.
      const max = view.state.doc.length;
      const anchor = Math.min(state.anchor, max);
      const head = Math.min(state.head, max);
      view.dispatch({ selection: { anchor, head } });
      view.scrollDOM.scrollTop = state.scrollTop;
    },
    [getPath],
  );

  return { extension, restore };
}
