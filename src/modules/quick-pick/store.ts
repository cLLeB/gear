// The quick pick and input box are one modal surface driven by a promise API,
// modelled on VS Code's `showQuickPick` / `showInputBox`: any module can await a
// choice or a line of text without owning dialog state. A new request cancels
// the one on screen (resolving it with `undefined`), so callers never leak.

import { create } from "zustand";
import type { QuickPickItem } from "./rank";

export interface QuickPickOptions {
  title?: string;
  placeholder?: string;
  /** Shown when nothing matches. */
  emptyText?: string;
  /**
   * Lets the typed text itself be accepted when it matches no item — for pickers
   * that suggest values but allow free input (branch names, directories).
   */
  allowCustom?: boolean;
}

export interface InputBoxOptions {
  title?: string;
  placeholder?: string;
  value?: string;
  /** Short hint under the field. */
  prompt?: string;
  /** Return an error message to block submission, or null when valid. */
  validate?: (value: string) => string | null;
  password?: boolean;
}

export type QuickPickRequest =
  | {
      kind: "pick";
      items: QuickPickItem<unknown>[] | null;
      loadError: string | null;
      options: QuickPickOptions;
      resolve: (value: { value: unknown } | { custom: string } | undefined) => void;
    }
  | {
      kind: "input";
      options: InputBoxOptions;
      resolve: (value: string | undefined) => void;
    };

interface State {
  request: QuickPickRequest | null;
  open: (req: QuickPickRequest) => void;
  setItems: (req: QuickPickRequest, items: QuickPickItem<unknown>[]) => void;
  setLoadError: (req: QuickPickRequest, message: string) => void;
  close: () => void;
}

export const useQuickPickStore = create<State>((set, get) => ({
  request: null,
  open: (req) => {
    const prev = get().request;
    set({ request: req });
    prev?.resolve(undefined);
  },
  setItems: (req, items) => {
    if (get().request !== req || req.kind !== "pick") return;
    set({ request: { ...req, items } });
  },
  setLoadError: (req, message) => {
    if (get().request !== req || req.kind !== "pick") return;
    set({ request: { ...req, loadError: message } });
  },
  close: () => {
    const prev = get().request;
    set({ request: null });
    prev?.resolve(undefined);
  },
}));

/**
 * Ask the user to pick one item. `items` may be a promise: the picker opens
 * immediately with a loading state so slow sources (git, fs) feel responsive.
 * Resolves with the chosen value, or `undefined` when dismissed.
 */
export function quickPick<T>(
  items: QuickPickItem<T>[] | Promise<QuickPickItem<T>[]>,
  options: QuickPickOptions = {},
): Promise<T | undefined> {
  return quickPickWithCustom(items, options).then((r) =>
    r && "value" in r ? r.value : undefined,
  );
}

/** Like quickPick, but also reports free text accepted via `allowCustom`. */
export function quickPickWithCustom<T>(
  items: QuickPickItem<T>[] | Promise<QuickPickItem<T>[]>,
  options: QuickPickOptions = {},
): Promise<{ value: T } | { custom: string } | undefined> {
  return new Promise((resolve) => {
    const store = useQuickPickStore.getState();
    const req: QuickPickRequest = {
      kind: "pick",
      items: Array.isArray(items) ? (items as QuickPickItem<unknown>[]) : null,
      loadError: null,
      options,
      resolve: resolve as (v: { value: unknown } | { custom: string } | undefined) => void,
    };
    store.open(req);
    if (!Array.isArray(items)) {
      items.then(
        (loaded) => {
          // `open` may have been superseded; setItems ignores stale requests.
          const current = useQuickPickStore.getState().request;
          if (current && current.resolve === req.resolve) {
            useQuickPickStore.getState().setItems(current, loaded as QuickPickItem<unknown>[]);
          }
        },
        (e: unknown) => {
          const current = useQuickPickStore.getState().request;
          if (current && current.resolve === req.resolve) {
            useQuickPickStore
              .getState()
              .setLoadError(current, e instanceof Error ? e.message : String(e));
          }
        },
      );
    }
  });
}

/** Ask the user for a line of text. Resolves `undefined` when dismissed. */
export function inputBox(options: InputBoxOptions = {}): Promise<string | undefined> {
  return new Promise((resolve) => {
    useQuickPickStore.getState().open({ kind: "input", options, resolve });
  });
}

/** A two-choice confirmation rendered as a quick pick. */
export async function confirmPick(
  title: string,
  confirmLabel: string,
  detail?: string,
): Promise<boolean> {
  const choice = await quickPick(
    [
      { label: confirmLabel, value: true, detail },
      { label: "Cancel", value: false },
    ],
    { title, placeholder: title },
  );
  return choice === true;
}
