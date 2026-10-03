// Reactive "last command" per pane for the status bar.

import { create } from "zustand";
import type { FinishedCommand } from "../lib/useTerminalSession";

export type LastCommandSummary = Pick<FinishedCommand, "command" | "exitCode" | "durationMs" | "finishedAt">;

interface LastCommandState {
  byLeaf: Record<number, LastCommandSummary>;
  activeLeaf: number | null;
  record: (leafId: number, cmd: LastCommandSummary) => void;
  setActiveLeaf: (leafId: number | null) => void;
}

export const useLastCommandStore = create<LastCommandState>((set) => ({
  byLeaf: {},
  activeLeaf: null,
  record: (leafId, cmd) => set((s) => ({ byLeaf: { ...s.byLeaf, [leafId]: cmd } })),
  setActiveLeaf: (leafId) => set((s) => (s.activeLeaf === leafId ? s : { activeLeaf: leafId })),
}));

/** "1.2s", "45s", "3m 05s", "1h 02m" — compact for a status bar. */
export function formatDurationShort(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
