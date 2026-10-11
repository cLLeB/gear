// Pane monitors, as in tmux's monitor-activity / monitor-silence and
// iTerm2's "Alert on next mark": arm a pane, get told once when it prints
// something (activity) or stops printing for a while (silence). Each monitor
// fires once and disarms.

export type MonitorKind = "activity" | "silence";

export interface MonitorEvents {
  fire: (leafId: number, kind: MonitorKind) => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

interface Armed {
  kind: MonitorKind;
  silenceMs: number;
  timer: unknown;
  sawOutput: boolean;
}

export class PaneMonitors {
  private armed = new Map<number, Armed>();
  constructor(private readonly ev: MonitorEvents) {}

  arm(leafId: number, kind: MonitorKind, silenceMs = 10_000): void {
    this.disarm(leafId);
    const a: Armed = { kind, silenceMs, timer: null, sawOutput: false };
    this.armed.set(leafId, a);
    // Silence counts from now, so a pane that is already quiet fires too.
    if (kind === "silence") this.restartSilence(leafId, a);
  }

  disarm(leafId: number): void {
    const a = this.armed.get(leafId);
    if (a?.timer) this.ev.clearTimer(a.timer);
    this.armed.delete(leafId);
  }

  isArmed(leafId: number): MonitorKind | null {
    return this.armed.get(leafId)?.kind ?? null;
  }

  /** Feed output activity for a pane. */
  output(leafId: number): void {
    const a = this.armed.get(leafId);
    if (!a) return;
    a.sawOutput = true;
    if (a.kind === "activity") {
      this.disarm(leafId);
      this.ev.fire(leafId, "activity");
    } else this.restartSilence(leafId, a);
  }

  private restartSilence(leafId: number, a: Armed): void {
    if (a.timer) this.ev.clearTimer(a.timer);
    a.timer = this.ev.setTimer(() => {
      this.armed.delete(leafId);
      this.ev.fire(leafId, "silence");
    }, a.silenceMs);
  }
}

// ------------------------------------------------------------- install

import { app } from "@/app/appBridge";
import { osNotify } from "@/modules/agents/lib/notify";
import { inputBox, quickPick } from "@/modules/quick-pick";
import { toast } from "sonner";
import { onTerminalOutputActivity } from "../lib/outputTap";
import { hasLeaf } from "../lib/panes";

function paneName(leafId: number): string {
  for (const t of app().tabs()) {
    if (t.kind === "terminal" && hasLeaf(t.paneTree, leafId)) return t.customTitle ?? t.title;
  }
  return "terminal";
}

const monitors = new PaneMonitors({
  fire: (leafId, kind) => {
    const title = kind === "activity" ? `Activity in ${paneName(leafId)}` : `${paneName(leafId)} went quiet`;
    const body = kind === "activity" ? "The monitored pane printed new output." : "No output for the monitored period.";
    if (app().activeTerminalLeaf() === leafId && document.hasFocus()) toast.message(title, { description: body });
    else void osNotify(title, body);
  },
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
});

export function installPaneMonitors(): () => void {
  return onTerminalOutputActivity((leafId) => monitors.output(leafId));
}

export async function armMonitor(): Promise<void> {
  const leaf = app().activeTerminalLeaf();
  if (leaf === null) {
    toast.error("Focus a terminal first");
    return;
  }
  const current = monitors.isArmed(leaf);
  const kind = await quickPick<"activity" | "silence" | "off">(
    [
      { label: "Notify on next output (activity)", value: "activity" },
      { label: "Notify when output stops (silence)…", value: "silence" },
      ...(current ? [{ label: `Stop monitoring (${current})`, value: "off" as const }] : []),
    ],
    { title: "Monitor this pane" },
  );
  if (!kind) return;
  if (kind === "off") {
    monitors.disarm(leaf);
    toast.success("Monitoring stopped");
    return;
  }
  let silenceMs = 10_000;
  if (kind === "silence") {
    const secs = await inputBox({
      title: "Quiet for how many seconds?",
      value: "10",
      validate: (v) => (/^\d+$/.test(v.trim()) && Number(v) >= 2 && Number(v) <= 3600 ? null : "2–3600 seconds"),
    });
    if (!secs) return;
    silenceMs = Number(secs) * 1000;
  }
  monitors.arm(leaf, kind, silenceMs);
  toast.success(kind === "activity" ? "You'll be notified on the next output" : `You'll be notified after ${silenceMs / 1000}s of silence`);
}
