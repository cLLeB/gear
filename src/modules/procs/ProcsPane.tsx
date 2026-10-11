// gear-procs://: listening ports (open, stop) and a live process tree with
// CPU / memory, search, sort, "only this workspace", collapse and kill.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { quickPick } from "@/modules/quick-pick";
import { filterProcs, formatDuration, formatKb, PORT_HINTS, processTree, type Proc } from "./model";
import { kill, sample, useProcStore } from "./store";

type Sort = "cpu" | "mem" | "pid" | "name";

async function menu(p: Proc): Promise<void> {
  const pick = await quickPick(
    [
      { label: "Stop (SIGTERM)", value: () => kill(p.pid) },
      { label: "Stop with children", value: () => kill(p.pid, { tree: true }) },
      { label: "Force kill (SIGKILL)", value: () => kill(p.pid, { force: true }) },
      ...(p.cwd ? [{ label: "Open a terminal in its folder", detail: p.cwd, value: () => app().openTerminal({ cwd: p.cwd }) }] : []),
      { label: "Copy command line", value: () => navigator.clipboard.writeText(p.args) },
      { label: "Copy PID", value: () => navigator.clipboard.writeText(String(p.pid)) },
    ],
    { title: `${p.name} (${p.pid})` },
  );
  void pick?.();
}

function Bar({ v, max, color }: { v: number; max: number; color: string }) {
  return (
    <div className="relative h-1.5 w-14 rounded bg-muted">
      <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${Math.min(100, (v / Math.max(max, 1e-9)) * 100)}%`, background: color }} />
    </div>
  );
}

export const ProcsPane = forwardRef<EditorPaneHandle, { path: string }>(function ProcsPane({ path }, ref) {
  const { procs, ports, error, sampledAt } = useProcStore();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("cpu");
  const [mine, setMine] = useState(false);
  const [paused, setPaused] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const root = app().workspaceRoot()?.replace(/\\/g, "/") ?? null;

  useEffect(() => {
    void sample(true);
    if (paused) return;
    const t = setInterval(() => document.visibilityState === "visible" && void sample(), 2000);
    return () => clearInterval(t);
  }, [paused]);

  useImperativeHandle(
    ref,
    () =>
      ({
        setQuery,
        findNext: () => {},
        findPrevious: () => {},
        clearQuery: () => setQuery(""),
        focus: () => {},
        getSelection: () => null,
        getPath: () => path,
        reload: () => (void sample(true), true),
        gotoLine: () => {},
        undo: () => {},
        redo: () => {},
        openFindReplace: () => {},
        toggleBlame: () => {},
        save: async () => {},
      }) as EditorPaneHandle,
    [path],
  );

  // Processes started from this workspace: their cwd is inside it, or the command line mentions it.
  const workspacePids = useMemo(() => {
    if (!root) return new Set<number>();
    const r = root.toLowerCase();
    return new Set(procs.filter((p) => (p.cwd && (p.cwd.toLowerCase() === r || p.cwd.toLowerCase().startsWith(`${r}/`))) || p.args.toLowerCase().replace(/\\/g, "/").includes(r)).map((p) => p.pid));
  }, [procs, root]);
  const rows = useMemo(() => processTree(filterProcs(procs, query, mine ? workspacePids : undefined), sort, collapsed), [procs, query, mine, workspacePids, sort, collapsed]);
  const maxCpu = Math.max(1, ...rows.map((r) => r.cpuTotal));
  const maxMem = Math.max(1, ...rows.map((r) => r.rssTotal));
  const th = (s: Sort, label: string, cls = "") => (
    <th className={cn("cursor-pointer px-2 py-1 font-normal hover:text-foreground", sort === s && "text-foreground", cls)} onClick={() => setSort(s)}>
      {label}
      {sort === s ? " ↓" : ""}
    </th>
  );
  return (
    <div className="flex h-full flex-col text-[12px]">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <span className="font-medium">Ports & processes</span>
        <span className="text-[11px] text-muted-foreground">
          {procs.length} processes · {ports.length} listening{sampledAt ? ` · ${new Date(sampledAt).toLocaleTimeString([], { hour12: false })}` : ""}
        </span>
        {error && <span className="truncate text-[11px] text-destructive">{error}</span>}
        <span className="flex-1" />
        <input className="w-52 rounded border border-border/60 bg-background px-2 py-0.5" placeholder="Filter by name, pid, command…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {root && (
          <label className="flex items-center gap-1 text-[11.5px]" title="Processes whose working folder or command line is inside the open folder">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            This workspace ({workspacePids.size})
          </label>
        )}
        <button type="button" className={cn("rounded px-2 py-0.5", paused ? "bg-amber-500/15 text-amber-600" : "hover:bg-muted")} onClick={() => setPaused((x) => !x)}>
          {paused ? "Paused" : "Live"}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Listening ports</div>
        <table className="mb-3 w-full">
          <tbody>
            {ports.map((l) => (
              <tr key={`${l.port}-${l.pid}`} className="group border-b border-border/30 hover:bg-muted/30">
                <td className="w-20 px-3 py-1 font-mono font-medium tabular-nums">{l.port}</td>
                <td className="px-2 text-muted-foreground">{l.address}</td>
                <td className="px-2">{l.command ?? <span className="text-muted-foreground">(not visible)</span>}</td>
                <td className="px-2 font-mono text-muted-foreground">{l.pid ?? ""}</td>
                <td className="px-2 text-[11px] text-muted-foreground">{PORT_HINTS[l.port] ?? ""}</td>
                <td className="whitespace-nowrap px-3 text-right opacity-0 group-hover:opacity-100">
                  <button type="button" className="rounded px-1.5 py-0.5 hover:bg-muted" onClick={() => app().openPreview(`http://localhost:${l.port}`)}>
                    Open
                  </button>
                  {l.pid && (
                    <>
                      <button type="button" className="rounded px-1.5 py-0.5 hover:bg-muted" onClick={() => (setQuery(String(l.pid)), setMine(false))}>
                        Show
                      </button>
                      <button type="button" className="rounded px-1.5 py-0.5 text-destructive hover:bg-muted" onClick={() => void kill(l.pid!)}>
                        Stop
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!ports.length && (
              <tr>
                <td className="px-3 py-1 text-muted-foreground">Nothing is listening.</td>
              </tr>
            )}
          </tbody>
        </table>
        <table className="w-full">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b border-border/40 text-left text-[11px] text-muted-foreground">
              {th("name", "Process", "pl-3")}
              {th("pid", "PID")}
              {th("cpu", "CPU")}
              {th("mem", "Memory")}
              <th className="px-2 font-normal">User</th>
              <th className="px-2 font-normal">Up</th>
              <th className="px-2 font-normal">Command</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ proc: p, depth, cpuTotal, rssTotal, children }) => (
              <tr key={p.pid} className={cn("border-b border-border/20 hover:bg-muted/30", workspacePids.has(p.pid) && "bg-primary/5")} onContextMenu={(e) => (e.preventDefault(), void menu(p))} onDoubleClick={() => void menu(p)}>
                <td className="whitespace-nowrap py-0.5 pr-2" style={{ paddingLeft: 12 + depth * 14 }}>
                  {children > 0 ? (
                    <button type="button" className="w-3 text-[10px] text-muted-foreground" onClick={() => setCollapsed((c) => (c.has(p.pid) ? new Set([...c].filter((x) => x !== p.pid)) : new Set([...c, p.pid])))}>
                      {collapsed.has(p.pid) ? "▸" : "▾"}
                    </button>
                  ) : (
                    <span className="inline-block w-3" />
                  )}
                  <span className="font-medium">{p.name}</span>
                  {children > 0 && collapsed.has(p.pid) && <span className="ml-1 text-[10.5px] text-muted-foreground">+{children}</span>}
                </td>
                <td className="px-2 font-mono tabular-nums text-muted-foreground">{p.pid}</td>
                <td className="px-2">
                  <div className="flex items-center gap-1.5 tabular-nums">
                    <Bar v={cpuTotal} max={maxCpu} color="#3b82f6" />
                    {cpuTotal.toFixed(1)}%
                  </div>
                </td>
                <td className="px-2">
                  <div className="flex items-center gap-1.5 whitespace-nowrap tabular-nums">
                    <Bar v={rssTotal} max={maxMem} color="#a855f7" />
                    {formatKb(rssTotal)}
                  </div>
                </td>
                <td className="px-2 text-muted-foreground">{p.user}</td>
                <td className="whitespace-nowrap px-2 text-muted-foreground">{formatDuration(p.elapsedSec)}</td>
                <td className="max-w-0 truncate px-2 font-mono text-[11.5px] text-muted-foreground" title={p.args}>
                  {p.args}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});
