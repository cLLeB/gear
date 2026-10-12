// gear-time://: how long you worked, per day, project, language and file.
// The tracker counts only while Gear is in front and you are active; the
// numbers stay in this machine's local storage. It is off until turned on.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { confirmPick } from "@/modules/quick-pick";
import { toolPaneHandle } from "@/modules/tools/paneHandle";
import { addSample, creditFor, dateKey, formatDuration, lastDays, parseData, prune, streak, summarize, toCsv, type Data, type Kind, type Sample } from "./model";

export const TIME_PATH = "gear-time://Time";
const DATA_KEY = "gear.timeTracking.data";
const ON_KEY = "gear.timeTracking.on";
const TICK_MS = 30000;

function read<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export const useTime = create<{ data: Data; on: boolean }>(() => ({
  data: read(() => parseData(localStorage.getItem(DATA_KEY)), {}),
  on: read(() => localStorage.getItem(ON_KEY) === "1", false),
}));

let lastActivity = 0;
let lastTick = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function currentSample(): Sample {
  const tab = app().tabs().find((t) => t.id === app().activeTabId());
  const kind: Kind = tab?.kind === "terminal" ? "terminal" : tab?.kind === "editor" ? "editing" : "other";
  const ed = kind === "editing" ? getActiveEditor() : null;
  const file = ed?.path && tab?.kind === "editor" && tab.path === ed.path ? ed.path : null;
  return { project: app().workspaceRoot(), language: file ? (ed?.languageId ?? null) : null, file, kind };
}

function tick(): void {
  const now = Date.now();
  const credit = creditFor((now - lastTick) / 1000, (now - lastActivity) / 1000, document.hasFocus());
  lastTick = now;
  if (!credit) return;
  const today = dateKey(new Date());
  const data = prune(addSample(useTime.getState().data, today, currentSample(), Math.round(credit)), today);
  useTime.setState({ data });
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(data));
  } catch {
    // Storage full or unavailable: the session's numbers stay in memory.
  }
}

const onActivity = () => {
  lastActivity = Date.now();
};

function run(on: boolean): void {
  if (timer) clearInterval(timer);
  timer = null;
  for (const ev of ["keydown", "mousedown", "wheel"]) window.removeEventListener(ev, onActivity, true);
  if (!on) return;
  for (const ev of ["keydown", "mousedown", "wheel"]) window.addEventListener(ev, onActivity, { capture: true, passive: true });
  lastTick = Date.now();
  lastActivity = Date.now();
  timer = setInterval(tick, TICK_MS);
}

/** Called once at startup: resumes tracking when it was left on. */
export function initTimeTracking(): void {
  run(useTime.getState().on);
}

export function setTracking(on: boolean): void {
  if (useTime.getState().on && !on) tick();
  useTime.setState({ on });
  try {
    localStorage.setItem(ON_KEY, on ? "1" : "0");
  } catch {
    // The choice then lasts for this session only.
  }
  run(on);
  toast.success(on ? "Time tracking is on" : "Time tracking is off");
}

export function openTime(): void {
  app().openFile(TIME_PATH);
}

async function clearAll(): Promise<void> {
  if (!(await confirmPick("Delete all tracked time?", "Delete everything", "This cannot be undone."))) return;
  useTime.setState({ data: {} });
  try {
    localStorage.removeItem(DATA_KEY);
  } catch {
    // Nothing stored to remove.
  }
}

const RANGES = [
  { id: 1, label: "Today" },
  { id: 7, label: "7 days" },
  { id: 30, label: "30 days" },
  { id: 90, label: "90 days" },
];

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";

function Breakdown({ title, rows, total, short, onOpen }: { title: string; rows: [string, number][]; total: number; short?: (k: string) => string; onOpen?: (k: string) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 8);
  return (
    <div className="min-w-[260px] flex-1 rounded-md border border-border/60">
      <div className="border-b border-border/60 px-2 py-1 font-medium">{title}</div>
      {rows.length === 0 && <div className="px-2 py-2 text-muted-foreground">Nothing yet.</div>}
      {shown.map(([k, v]) => (
        <div key={k} className="relative flex items-center gap-2 px-2 py-0.5" title={k}>
          <div className="absolute inset-y-0 left-0 bg-primary/10" style={{ width: `${total ? (v / total) * 100 : 0}%` }} />
          {onOpen ? (
            <button type="button" className="relative min-w-0 flex-1 truncate text-left font-mono text-[12px] hover:underline" onClick={() => onOpen(k)}>
              {short ? short(k) : k}
            </button>
          ) : (
            <span className="relative min-w-0 flex-1 truncate font-mono text-[12px]">{short ? short(k) : k}</span>
          )}
          <span className="relative tabular-nums">{formatDuration(v)}</span>
        </div>
      ))}
      {rows.length > 8 && (
        <button type="button" className="w-full px-2 py-0.5 text-left text-muted-foreground hover:bg-muted" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

const baseName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;

export const TimePane = forwardRef<EditorPaneHandle, { path: string }>(function TimePane({ path }, ref) {
  const { data, on } = useTime();
  const [range, setRange] = useState(7);
  const [now, setNow] = useState(() => new Date());

  useImperativeHandle(ref, () => toolPaneHandle(path, { reload: () => (setNow(new Date()), true) }), [path]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const today = dateKey(now);
  const days = useMemo(() => lastDays(today, range), [today, range]);
  const sum = useMemo(() => summarize(data, days), [data, days]);
  const max = Math.max(1, ...sum.days.map((d) => d.total));
  const run = streak(data, today);

  return (
    <div className="flex h-full flex-col overflow-auto text-[12.5px]">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 p-2">
        <span className={cn("h-2 w-2 rounded-full", on ? "bg-emerald-500" : "bg-muted-foreground/40")} />
        <span>{on ? "Tracking" : "Tracking is off"}</span>
        <button type="button" className={cn(btn, !on && "bg-primary/10")} onClick={() => setTracking(!on)}>
          {on ? "Turn off" : "Turn on"}
        </button>
        <span className="mx-1 h-4 w-px bg-border" />
        {RANGES.map((r) => (
          <button key={r.id} type="button" className={cn(btn, range === r.id && "bg-muted font-medium")} onClick={() => setRange(r.id)}>
            {r.label}
          </button>
        ))}
        <span className="flex-1" />
        <button type="button" className={btn} disabled={!sum.total} title="One row per day and project" onClick={() => void navigator.clipboard.writeText(toCsv(data, days)).then(() => toast.success("CSV copied to the clipboard"))}>
          Copy CSV
        </button>
        <button type="button" className={btn} disabled={!Object.keys(data).length} onClick={() => void clearAll()}>
          Delete data
        </button>
      </div>
      {!on && !Object.keys(data).length ? (
        <div className="max-w-[640px] p-6 text-muted-foreground">
          Time tracking counts the time Gear is in front and you are typing, clicking or scrolling, and sorts it by folder, language and file. It stops counting after two minutes without input. Everything is stored on this machine only. Turn it on to start.
        </div>
      ) : (
        <div className="space-y-3 p-3">
          <div className="flex flex-wrap gap-6">
            <div>
              <div className="text-[22px] font-semibold tabular-nums" data-total>
                {formatDuration(sum.total)}
              </div>
              <div className="text-muted-foreground">{range === 1 ? "today" : `in the last ${range} days`}</div>
            </div>
            {range > 1 && (
              <div>
                <div className="text-[22px] font-semibold tabular-nums">{formatDuration(sum.activeDays ? sum.total / sum.activeDays : 0)}</div>
                <div className="text-muted-foreground">per active day ({sum.activeDays})</div>
              </div>
            )}
            <div>
              <div className="text-[22px] font-semibold tabular-nums">{run}</div>
              <div className="text-muted-foreground">{run === 1 ? "day in a row" : "days in a row"}</div>
            </div>
          </div>
          {range > 1 && (
            <div className="flex h-[120px] items-end gap-px rounded-md border border-border/60 p-2">
              {sum.days.map((d) => (
                <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${d.day} — ${formatDuration(d.total)}`}>
                  <div className={cn("rounded-t", d.day === today ? "bg-primary" : "bg-primary/50")} style={{ height: `${(d.total / max) * 100}%`, minHeight: d.total ? 2 : 0 }} />
                  {range <= 30 && <div className="mt-0.5 truncate text-center text-[9.5px] text-muted-foreground">{d.day.slice(8)}</div>}
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <Breakdown title="Folders" rows={sum.projects} total={sum.total} short={baseName} />
            <Breakdown title="Languages" rows={sum.languages} total={sum.total} />
            <Breakdown title="Kind of work" rows={sum.kinds} total={sum.total} />
          </div>
          <Breakdown title="Files" rows={sum.files} total={sum.total} short={baseName} onOpen={(f) => app().openFile(f)} />
        </div>
      )}
    </div>
  );
});

export const TIME_ACTIONS = [
  { id: "time.open", label: "Time: Show time tracking", keywords: ["time", "tracking", "hours", "timesheet", "activity", "statistics", "wakatime"], run: openTime },
  { id: "time.toggle", label: "Time: Turn time tracking on / off", keywords: ["time", "tracking", "start", "stop", "pause"], run: () => setTracking(!useTime.getState().on) },
];
