/**
 * Bridges the renderer pool's imperative paste path to a dialog rendered at the
 * app root. Holds at most one pending request; a second request resolves the
 * first as declined so no caller waits on a promise that can never settle.
 */

import { create } from "zustand";
import type { PasteAnalysis } from "./pasteGuard";

type PendingPaste = {
  analysis: PasteAnalysis;
  resolve: (approved: boolean) => void;
};

type State = {
  pending: PendingPaste | null;
  confirm: (analysis: PasteAnalysis) => Promise<boolean>;
  answer: (approved: boolean) => void;
};

export const usePastePromptStore = create<State>((set, get) => ({
  pending: null,

  confirm: (analysis) => {
    get().pending?.resolve(false);
    return new Promise<boolean>((resolve) => {
      set({ pending: { analysis, resolve } });
    });
  },

  answer: (approved) => {
    const { pending } = get();
    if (!pending) return;
    pending.resolve(approved);
    set({ pending: null });
  },
}));
