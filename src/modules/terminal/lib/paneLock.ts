// Read-only panes: keystrokes and pastes are dropped so a pane tailing logs,
// running a server or showing a production shell can't receive stray input.
// Programmatic sends from Gear features still go through the guarded paths.

import { create } from "zustand";

interface PaneLockState {
  locked: Record<number, true>;
  toggle: (leafId: number) => boolean;
  unlock: (leafId: number) => void;
}

export const usePaneLockStore = create<PaneLockState>((set, get) => ({
  locked: {},
  toggle: (leafId) => {
    const next = { ...get().locked };
    const nowLocked = !next[leafId];
    if (nowLocked) next[leafId] = true;
    else delete next[leafId];
    set({ locked: next });
    return nowLocked;
  },
  unlock: (leafId) => {
    if (!get().locked[leafId]) return;
    const next = { ...get().locked };
    delete next[leafId];
    set({ locked: next });
  },
}));

export function isPaneLocked(leafId: number): boolean {
  return !!usePaneLockStore.getState().locked[leafId];
}

/**
 * Whether input from the user may reach the pty. Terminal *responses* that
 * xterm generates (cursor position reports, focus events, mouse reports
 * when an app enabled them) are let through so locked TUIs keep working.
 */
export function allowUserInput(leafId: number, data: string): boolean {
  if (!isPaneLocked(leafId)) return true;
  // CSI ... R (cursor report), CSI I / CSI O (focus), CSI ? ... c (DA)
  return /^\x1b\[(\d+;\d+R|[IO]|\?[\d;]*c|>[\d;]*c)$/.test(data);
}
