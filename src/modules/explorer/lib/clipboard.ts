import { create } from "zustand";

/**
 * Gear's own copy/cut register for the sidebar tree.
 *
 * This is deliberately separate from the OS clipboard: it records *intent*
 * (copy vs cut) that the OS clipboard has no portable way to carry, and it
 * survives the user copying unrelated text in between. A paste prefers whatever
 * the OS clipboard holds, falling back to this — see `planPaste`.
 */
export type ClipboardMode = "copy" | "cut";

export type ClipboardEntry = {
  paths: readonly string[];
  mode: ClipboardMode;
};

type State = {
  entry: ClipboardEntry | null;
  copy: (paths: readonly string[]) => void;
  cut: (paths: readonly string[]) => void;
  clear: () => void;
  /** Whether `path` is currently cut, so the tree can dim it. */
  isCut: (path: string) => boolean;
};

export const useExplorerClipboard = create<State>((set, get) => ({
  entry: null,

  copy: (paths) => {
    if (paths.length === 0) return;
    set({ entry: { paths: [...paths], mode: "copy" } });
  },

  cut: (paths) => {
    if (paths.length === 0) return;
    set({ entry: { paths: [...paths], mode: "cut" } });
  },

  clear: () => set({ entry: null }),

  isCut: (path) => {
    const entry = get().entry;
    return entry?.mode === "cut" && entry.paths.includes(path);
  },
}));
