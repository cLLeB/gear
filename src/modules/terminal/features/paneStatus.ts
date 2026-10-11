// Per-pane status surfaced on tabs: progress reported with OSC 9;4
// (Windows Terminal / ConEmu / Ghostty spec) and "needs attention" from the
// terminal bell in a background pane.

import { create } from "zustand";

export type ProgressState = "none" | "normal" | "error" | "indeterminate" | "paused";

export interface PaneProgress {
  state: ProgressState;
  /** 0-100; meaningful for normal/error/paused. */
  value: number;
}

/** OSC 9;4;<st>[;<pr>] → progress, or null when the payload is not progress. */
export function parseProgress(data: string): PaneProgress | null {
  const m = /^4(?:;(\d))?(?:;(\d{1,3}))?/.exec(data);
  if (!m) return null;
  const st = Number(m[1] ?? 0);
  const value = Math.max(0, Math.min(100, Number(m[2] ?? 0)));
  const state: ProgressState = st === 1 ? "normal" : st === 2 ? "error" : st === 3 ? "indeterminate" : st === 4 ? "paused" : "none";
  return { state, value };
}

/** Combine pane progress for a tab: errors win, then paused, then active. */
export function aggregateProgress(list: readonly PaneProgress[]): PaneProgress | null {
  const active = list.filter((p) => p.state !== "none");
  if (active.length === 0) return null;
  const rank: Record<ProgressState, number> = { error: 0, paused: 1, normal: 2, indeterminate: 3, none: 4 };
  const top = [...active].sort((a, b) => rank[a.state] - rank[b.state])[0];
  const withValue = active.filter((p) => p.state !== "indeterminate");
  const value = withValue.length ? Math.round(withValue.reduce((s, p) => s + p.value, 0) / withValue.length) : 0;
  return { state: top.state === "indeterminate" && withValue.length ? withValue[0].state : top.state, value };
}

interface PaneStatusState {
  progress: Record<number, PaneProgress>;
  attention: Record<number, true>;
  setProgress: (leafId: number, p: PaneProgress) => void;
  setAttention: (leafId: number, on: boolean) => void;
  forget: (leafId: number) => void;
}

export const usePaneStatusStore = create<PaneStatusState>((set) => ({
  progress: {},
  attention: {},
  setProgress: (leafId, p) =>
    set((s) => {
      const next = { ...s.progress };
      if (p.state === "none") delete next[leafId];
      else next[leafId] = p;
      return { progress: next };
    }),
  setAttention: (leafId, on) =>
    set((s) => {
      if (!!s.attention[leafId] === on) return s;
      const next = { ...s.attention };
      if (on) next[leafId] = true;
      else delete next[leafId];
      return { attention: next };
    }),
  forget: (leafId) =>
    set((s) => {
      const progress = { ...s.progress };
      const attention = { ...s.attention };
      delete progress[leafId];
      delete attention[leafId];
      return { progress, attention };
    }),
}));

// ------------------------------------------------------------- install

import { onTerminalCommandFinished, registerTerminalExtension } from "../lib/useTerminalSession";

export function installProgressReporting(): () => void {
  const off = registerTerminalExtension((leafId, term) => {
    const h = term.parser.registerOscHandler(9, (data) => {
      const p = parseProgress(data);
      if (!p) return false; // not progress: leave it to the notification handler
      usePaneStatusStore.getState().setProgress(leafId, p);
      return true;
    });
    return () => h.dispose();
  });
  // A program that crashes mid-progress never sends 9;4;0; clear it when the command ends.
  const offFinish = onTerminalCommandFinished((cmd) => usePaneStatusStore.getState().setProgress(cmd.leafId, { state: "none", value: 0 }));
  return () => {
    off();
    offFinish();
  };
}

import { app } from "@/app/appBridge";
import { getFeature } from "@/modules/settings/useFeature";

/** Bell: badge background panes; optionally flash the visible one. */
export function installBellHandling(): () => void {
  return registerTerminalExtension((leafId, term) => {
    const sub = term.onBell(() => {
      const mode = getFeature("terminal.bell");
      if (mode === "off") return;
      const visible = app().activeTerminalLeaf() === leafId && document.hasFocus();
      if (!visible) {
        usePaneStatusStore.getState().setAttention(leafId, true);
        return;
      }
      if (mode === "badge+flash") {
        const el = term.element;
        if (!el) return;
        el.classList.remove("gear-visual-bell");
        // Force reflow so the animation restarts on rapid bells.
        void el.offsetWidth;
        el.classList.add("gear-visual-bell");
      }
    });
    return () => sub.dispose();
  });
}
