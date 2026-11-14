// gear-timeline://: every command your terminals ran, as bars on a time axis
// with one lane per pane. Green finished fine, red failed. Click a bar to jump
// to that command in its terminal. Below: what was slowest and what keeps failing.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { leafIds } from "@/modules/terminal/lib/panes";
import { listLeafCommands, scrollLeafToLine } from "@/modules/terminal/lib/useTerminalSession";
import { toolPaneHandle } from "@/modules/tools/paneHandle";
import { axisTicks, filterEntries, formatMs, lanesOf, outcomeOf, summarize, type TimelineEntry, type Window } from "./model";
import { clearTimeline, useTimeline } from "./store";

export const TIMELINE_PATH = "gear-timeline://Command timeline";

const RANGES = [
  { id: 15 * 60_000, label: "15 min" },
  { id: 60 * 60_000, label: "1 hour" },
  { id: 4 * 60 * 60_000, label: "4 hours" },
  { id: 0, label: "All" },
];

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";

const BAR = {
  ok: "bg-emerald-500/75 hover:bg-emerald-500",
  failed: "bg-red-500/80 hover:bg-red-500",
  unknown: "bg-muted-foreground/40 hover:bg-muted-foreground/60",
};

function openTimeline(): void {
  app().openFile(TIMELINE_PATH);
}

interface LaneInfo {
  tabId: number | null;
  label: string;
}

function laneInfo(leafId: number): LaneInfo {
  for (const t of app().tabs()) {
    if (t.kind !== "terminal") continue;
    const leaves = leafIds(t.paneTree);
    if (!leaves.includes(leafId)) continue;
    const title = ("customTitle" in t && t.customTitle) || t.title || "terminal";
    return { tabId: t.id, label: leaves.length > 1 ? `${title} · pane ${leaves.indexOf(leafId) + 1}` : title };
  }
  return { tabId: null, label: "closed pane" };
}

/** Show the command in its terminal: switch to the tab, then scroll to its prompt. */
function jumpTo(e: TimelineEntry): void {
  const { tabId } = laneInfo(e.leafId);
  if (tabId === null) return;
  app().activateTab(tabId);
  setTimeout(() => {
    const hit = listLeafCommands(e.leafId).find((c) => c.finishedAt === e.finishedAt && c.command.trim() === e.command);
    if (hit && hit.line >= 0) scrollLeafToLine(e.leafId, hit.line);
  }, 150);
}

const clock = (t: number, withSeconds: boolean) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...(withSeconds ? { second: "2-digit" } : {}) });

function describe(e: TimelineEntry): string {
  const outcome = outcomeOf(e);
  const status = outcome === "ok" ? "succeeded" : outcome === "failed" ? `failed (exit ${e.exitCode})` : "exit code unknown";
  return [e.command, `${formatMs(e.finishedAt - e.startedAt)} · ${status}`, `${clock(e.startedAt, true)} → ${clock(e.finishedAt, true)}`, e.cwd ?? ""].filter(Boolean).join("\n");
}

function Bars({ entries, win }: { entries: TimelineEntry[]; win: Window }) {
  const lanes = useMemo(() => lanesOf(entries), [entries]);
  const span = Math.max(1, win.to - win.from);
  const ticks = axisTicks(win, 7);
  const pct = (t: number) => ((Math.min(Math.max(t, win.from), win.to) - win.from) / span) * 100;
  const withSeconds = span <= 10 * 60_000;
  return (
    <div className="rounded-md border border-border/60 p-2" data-timeline>
      <div className="relative ml-[150px] h-5 border-b border-border/60 text-[10px] text-muted-foreground">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${pct(t)}%` }}>
            {clock(t, withSeconds)}
          </span>
        ))}
      </div>
      {lanes.map((leaf) => {
        const info = laneInfo(leaf);
        return (
          <div key={leaf} className="flex h-7 items-center border-b border-border/30 last:border-b-0">
            <div className="w-[150px] shrink-0 truncate pr-2 text-[11.5px] text-muted-foreground" title={info.label}>
              {info.label}
            </div>
            <div className="relative h-5 flex-1">
              {ticks.map((t) => (
                <span key={t} className="absolute top-0 h-full w-px bg-border/40" style={{ left: `${pct(t)}%` }} />
              ))}
              {entries
                .filter((e) => e.leafId === leaf)
                .map((e) => {
                  const left = pct(e.startedAt);
                  const width = Math.max(pct(e.finishedAt) - left, 0);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      data-outcome={outcomeOf(e)}
                      title={describe(e)}
                      onClick={() => jumpTo(e)}
                      className={cn("absolute top-0.5 h-4 min-w-[3px] overflow-hidden rounded-sm px-1 text-left text-[10px] leading-4 text-white", BAR[outcomeOf(e)])}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    >
                      <span className="pointer-events-none whitespace-nowrap">{e.command}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export const TimelinePane = forwardRef<EditorPaneHandle, { path: string }>(function TimelinePane({ path }, ref) {
  const { entries } = useTimeline();
  const [range, setRange] = useState(RANGES[0].id);
  const [query, setQuery] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useImperativeHandle(ref, () => toolPaneHandle(path, { reload: () => (setNow(Date.now()), true) }), [path]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const win = useMemo<Window>(() => {
    if (range) return { from: now - range, to: now };
    const first = entries.length ? Math.min(...entries.map((e) => e.startedAt)) : now - 60_000;
    return { from: first - Math.max(5_000, (now - first) * 0.02), to: now };
  }, [range, now, entries]);
  const shown = useMemo(() => filterEntries(entries, win, { query, failedOnly }), [entries, win, query, failedOnly]);
  const sum = useMemo(() => summarize(shown), [shown]);

  return (
    <div className="flex h-full flex-col overflow-auto text-[12.5px]">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 p-2">
        {RANGES.map((r) => (
          <button key={r.id} type="button" className={cn(btn, range === r.id && "bg-muted font-medium")} onClick={() => setRange(r.id)}>
            {r.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <input
          className="h-6 w-[200px] rounded border border-border/60 bg-transparent px-2 text-[12px] outline-none focus:border-primary"
          placeholder="Filter commands or folders"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="flex items-center gap-1 text-[11.5px]">
          <input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} />
          Failed only
        </label>
        <span className="flex-1" />
        <button type="button" className={btn} disabled={!entries.length} onClick={clearTimeline}>
          Clear
        </button>
      </div>
      {!entries.length ? (
        <div className="max-w-[640px] p-6 text-muted-foreground">
          Commands you run in any terminal show up here as they finish, one lane per pane, so you can see what ran when, what ran in parallel, how long it took and what failed. It needs shell integration (on by default) and keeps this session only; private terminals are left out.
        </div>
      ) : (
        <div className="space-y-3 p-3">
          <div className="flex flex-wrap gap-6">
            <Stat value={String(sum.count)} label={sum.count === 1 ? "command" : "commands"} />
            <Stat value={String(sum.failures)} label="failed" tone={sum.failures ? "bad" : undefined} />
            <Stat value={sum.count ? `${Math.round(((sum.count - sum.failures) / sum.count) * 100)}%` : "–"} label="success rate" />
            <Stat value={formatMs(sum.busyMs)} label="busy (overlaps counted once)" />
          </div>
          {shown.length ? <Bars entries={shown} win={win} /> : <div className="text-muted-foreground">Nothing in this range.</div>}
          <div className="flex flex-wrap gap-3">
            <Panel title="Slowest">
              {sum.slowest.map((e) => (
                <button key={e.id} type="button" className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-muted" title={describe(e)} onClick={() => jumpTo(e)}>
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", BAR[outcomeOf(e)])} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{e.command}</span>
                  <span className="tabular-nums text-muted-foreground">{formatMs(e.finishedAt - e.startedAt)}</span>
                </button>
              ))}
            </Panel>
            <Panel title="By command">
              <table className="w-full text-[11.5px]">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left font-normal">command</th>
                    <th className="text-right font-normal">runs</th>
                    <th className="text-right font-normal">failed</th>
                    <th className="text-right font-normal">avg</th>
                    <th className="text-right font-normal">total</th>
                  </tr>
                </thead>
                <tbody>
                  {sum.groups.slice(0, 12).map((g) => (
                    <tr key={g.key} className="hover:bg-muted/60">
                      <td className="max-w-[220px] truncate font-mono">{g.key}</td>
                      <td className="text-right tabular-nums">{g.runs}</td>
                      <td className={cn("text-right tabular-nums", g.failures && "text-red-500")}>{g.failures || ""}</td>
                      <td className="text-right tabular-nums">{formatMs(g.avgMs)}</td>
                      <td className="text-right tabular-nums">{formatMs(g.totalMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
});

function Stat({ value, label, tone }: { value: string; label: string; tone?: "bad" }) {
  return (
    <div>
      <div className={cn("text-[22px] font-semibold tabular-nums", tone === "bad" && "text-red-500")}>{value}</div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-[280px] flex-1 rounded-md border border-border/60 p-2">
      <div className="mb-1 font-medium">{title}</div>
      {children}
    </div>
  );
}

export const TIMELINE_ACTIONS = [
  {
    id: "timeline.open",
    label: "Terminal: Command timeline (what ran, when, how long, what failed)",
    keywords: ["timeline", "gantt", "history", "commands", "duration", "slow", "failed", "stats", "profile"],
    run: openTimeline,
  },
];
