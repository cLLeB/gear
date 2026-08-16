/**
 * Bridges the executor's `await requestTrust(...)` to a dialog rendered at the
 * app root. The store holds at most one pending request; its promise settles
 * when the user answers or the request is dismissed.
 */

import { create } from "zustand";
import type { RunConfig } from "./types";

type PendingRequest = {
  workspaceRoot: string;
  configs: RunConfig[];
  resolve: (approved: boolean) => void;
};

type State = {
  pending: PendingRequest | null;
  request: (input: {
    workspaceRoot: string;
    configs: RunConfig[];
  }) => Promise<boolean>;
  answer: (approved: boolean) => void;
};

export const useRunTrustStore = create<State>((set, get) => ({
  pending: null,

  request: ({ workspaceRoot, configs }) => {
    // A second request while one is open resolves the first as declined, so no
    // caller is left awaiting a promise that can never settle.
    get().pending?.resolve(false);
    return new Promise<boolean>((resolve) => {
      set({ pending: { workspaceRoot, configs, resolve } });
    });
  },

  answer: (approved) => {
    const { pending } = get();
    if (!pending) return;
    pending.resolve(approved);
    set({ pending: null });
  },
}));
