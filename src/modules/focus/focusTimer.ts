// A focus (Pomodoro) timer shown in the status bar.

import { create } from "zustand";
import { osNotify } from "@/modules/agents/lib/notify";
import { toast } from "sonner";

export interface FocusState {
  label: string | null;
  endsAt: number | null;
  totalMs: number;
  /** After a work block, offer a break of this length (ms); 0 = none. */
  breakMs: number;
  completedToday: number;
}

export const useFocusTimer = create<FocusState>(() => ({ label: null, endsAt: null, totalMs: 0, breakMs: 0, completedToday: 0 }));

let timer: ReturnType<typeof setTimeout> | null = null;

export function startFocus(label: string, minutes: number, breakMinutes = 0): void {
  stopFocus(false);
  const ms = minutes * 60_000;
  useFocusTimer.setState({ label, endsAt: Date.now() + ms, totalMs: ms, breakMs: breakMinutes * 60_000 });
  timer = setTimeout(finish, ms);
}

export function stopFocus(announce = true): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (announce && useFocusTimer.getState().endsAt) toast.info("Timer stopped");
  useFocusTimer.setState({ label: null, endsAt: null, totalMs: 0 });
}

function finish(): void {
  const { label, breakMs, completedToday } = useFocusTimer.getState();
  timer = null;
  const isBreak = label === "Break";
  useFocusTimer.setState({ label: null, endsAt: null, totalMs: 0, completedToday: completedToday + (isBreak ? 0 : 1) });
  void osNotify(isBreak ? "Break over" : `${label ?? "Focus"} done`, isBreak ? "Back to it." : breakMs ? `Take a ${Math.round(breakMs / 60_000)}-minute break.` : "Time's up.");
  toast.success(isBreak ? "Break over" : `${label ?? "Focus"} session complete`, {
    duration: 15_000,
    action: !isBreak && breakMs ? { label: "Start break", onClick: () => startFocus("Break", breakMs / 60_000) } : undefined,
  });
}

export function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
