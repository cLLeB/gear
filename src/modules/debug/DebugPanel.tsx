// The Debug sidebar view: run toolbar, call stack, variables, watch,
// breakpoints (with exception filters) and the debug console / REPL.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import type { StackFrame, Variable } from "./debugSession";
import {
  activeEntry,
  clearConsole,
  configurations,
  debugCommand,
  evaluateWatches,
  removeAllBreakpoints,
  removeBreakpoint,
  replEvaluate,
  resolveForWorkspace,
  restartDebugging,
  selectFrame,
  setBreakpointEnabled,
  setExceptionFilters,
  setWatches,
  startDebugging,
  startOrContinue,
  stopDebugging,
  useDebugStore,
  useWatchResults,
} from "./store";
import { quickPick } from "@/modules/quick-pick";

function Section({ title, count, children, defaultOpen = true, actions }: { title: string; count?: number; children: ReactNode; defaultOpen?: boolean; actions?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border/40">
      <div className="group flex h-7 items-center gap-1 px-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left" onClick={() => setOpen((o) => !o)}>
          <span className="w-3 text-[9px]">{open ? "▾" : "▸"}</span>
          <span className="truncate">{title}</span>
          {count !== undefined ? <span className="ml-1 rounded bg-muted px-1 font-normal normal-case">{count}</span> : null}
        </button>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">{actions}</div>
      </div>
      {open ? <div className="pb-1">{children}</div> : null}
    </div>
  );
}

function IconBtn({ label, onClick, children, disabled, className }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean; className?: string }) {
  return (
    <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className={cn("flex h-6 min-w-6 items-center justify-center rounded px-1 text-[12px] hover:bg-muted disabled:opacity-35", className)}>
      {children}
    </button>
  );
}

function VariableRow({ v, depth, reference }: { v: Variable; depth: number; reference: number }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<Variable[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(v.value);
  useEffect(() => setValue(v.value), [v.value]);
  const expandable = v.variablesReference > 0;
  const toggle = async () => {
    if (!expandable) return;
    if (!open && !children) setChildren(await activeEntry()?.session.variables(v.variablesReference).catch(() => []) ?? []);
    setOpen((o) => !o);
  };
  const commit = async (next: string) => {
    setEditing(false);
    if (next === v.value) return;
    try {
      const r = await activeEntry()?.session.setVariable(reference, v.name, next);
      if (r) setValue(r.value);
    } catch (e) {
      setValue(v.value);
      const { toast } = await import("sonner");
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <>
      <div className="flex min-w-0 items-center gap-1 py-px pr-2 font-mono text-[11.5px] hover:bg-muted/50" style={{ paddingLeft: 8 + depth * 12 }} onClick={() => void toggle()} onDoubleClick={() => !expandable && setEditing(true)} title={v.type ? `${v.name}: ${v.type}` : v.name}>
        <span className="w-3 shrink-0 text-[9px] text-muted-foreground">{expandable ? (open ? "▾" : "▸") : ""}</span>
        <span className="shrink-0 text-violet-600 dark:text-violet-300">{v.name}</span>
        <span className="shrink-0 text-muted-foreground">=</span>
        {editing ? (
          <input
            className="min-w-0 flex-1 rounded border bg-background px-1"
            autoFocus
            defaultValue={value}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commit((e.target as HTMLInputElement).value);
              if (e.key === "Escape") setEditing(false);
            }}
            onBlur={(e) => void commit(e.target.value)}
          />
        ) : (
          <span className="min-w-0 truncate">{value}</span>
        )}
      </div>
      {open && children?.map((c) => <VariableRow key={`${c.name}`} v={c} depth={depth + 1} reference={v.variablesReference} />)}
    </>
  );
}

function ScopesView({ frameId }: { frameId: number | null }) {
  const entry = useDebugStore((s) => s.sessions.find((e) => e.id === s.activeId) ?? null);
  const [scopes, setScopes] = useState<{ name: string; ref: number; vars: Variable[] | null; open: boolean }[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!entry || entry.state.status !== "stopped" || frameId === null) return void setScopes([]);
    void entry.session.scopes(frameId).then(async (sc) => {
      const rows = await Promise.all(sc.map(async (s, i) => ({ name: s.name, ref: s.variablesReference, open: i === 0 && !s.expensive, vars: i === 0 && !s.expensive ? await entry.session.variables(s.variablesReference).catch(() => []) : null })));
      if (!cancelled) setScopes(rows);
    }, () => !cancelled && setScopes([]));
    return () => {
      cancelled = true;
    };
  }, [entry?.id, entry?.state.status, frameId]);
  if (!scopes.length) return <div className="px-3 py-1 text-[11px] text-muted-foreground">{entry?.state.status === "stopped" ? "No variables" : "Pause to inspect variables"}</div>;
  return (
    <>
      {scopes.map((s, i) => (
        <div key={s.name}>
          <div
            className="flex cursor-pointer items-center gap-1 px-2 py-px text-[11.5px] font-medium hover:bg-muted/50"
            onClick={async () => {
              const vars = s.vars ?? (await entry?.session.variables(s.ref).catch(() => []) ?? []);
              setScopes((all) => all.map((x, k) => (k === i ? { ...x, vars, open: !x.open } : x)));
            }}
          >
            <span className="w-3 text-[9px] text-muted-foreground">{s.open ? "▾" : "▸"}</span>
            {s.name}
          </div>
          {s.open && s.vars?.map((v) => <VariableRow key={v.name} v={v} depth={1} reference={s.ref} />)}
        </div>
      ))}
    </>
  );
}

function CallStack() {
  const entry = useDebugStore((s) => s.sessions.find((e) => e.id === s.activeId) ?? null);
  const selected = useDebugStore((s) => s.selectedFrameId);
  if (!entry || entry.state.status !== "stopped") return <div className="px-3 py-1 text-[11px] text-muted-foreground">{entry ? "Running…" : "Not debugging"}</div>;
  const { threads, stoppedThreadId, frames } = entry.state;
  return (
    <>
      {threads.length > 1 ? (
        <select className="mx-2 mb-1 w-[calc(100%-16px)] rounded border bg-background px-1 py-0.5 text-[11px]" value={stoppedThreadId ?? ""} onChange={(e) => void entry.session.selectThread(Number(e.target.value))}>
          {threads.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} (#{t.id})
            </option>
          ))}
        </select>
      ) : null}
      {frames.map((f: StackFrame) => (
        <div
          key={f.id}
          onClick={() => selectFrame(f)}
          className={cn("flex cursor-pointer items-center gap-2 px-3 py-px text-[11.5px] hover:bg-muted/50", f.id === selected && "bg-primary/10", (f.presentationHint === "subtle" || f.presentationHint === "deemphasize" || !f.path) && "opacity-55")}
        >
          <span className="min-w-0 flex-1 truncate font-mono">{f.name}</span>
          <span className="shrink-0 truncate text-[10.5px] text-muted-foreground" title={f.path ?? ""}>
            {f.sourceName ?? f.path?.replace(/^.*[\\/]/, "") ?? "?"}:{f.line}
          </span>
        </div>
      ))}
    </>
  );
}

function Watches() {
  const watches = useDebugStore((s) => s.watches);
  const results = useWatchResults((s) => s.results);
  const [draft, setDraft] = useState("");
  return (
    <>
      {watches.map((w) => (
        <div key={w} className="group flex items-center gap-1 px-3 py-px font-mono text-[11.5px] hover:bg-muted/50">
          <span className="shrink-0 text-violet-600 dark:text-violet-300">{w}</span>
          <span className="text-muted-foreground">=</span>
          <span className={cn("min-w-0 flex-1 truncate", results[w]?.error && "text-red-600 dark:text-red-400")}>{results[w]?.value ?? "…"}</span>
          <button type="button" className="opacity-0 group-hover:opacity-100" title="Remove" onClick={() => setWatches(watches.filter((x) => x !== w))}>
            ✕
          </button>
        </div>
      ))}
      <input
        className="mx-2 mt-0.5 w-[calc(100%-16px)] rounded border border-border/50 bg-transparent px-1.5 py-0.5 font-mono text-[11px] placeholder:text-muted-foreground/70"
        placeholder="Add expression…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) {
            setWatches([...watches.filter((x) => x !== draft.trim()), draft.trim()]);
            setDraft("");
            void evaluateWatches();
          }
        }}
      />
    </>
  );
}

function Breakpoints() {
  const all = useDebugStore((s) => s.breakpoints);
  const filters = useDebugStore((s) => s.exceptionFilters);
  const entry = useDebugStore((s) => s.sessions.find((e) => e.id === s.activeId) ?? null);
  const available = entry?.session.caps.exceptionBreakpointFilters ?? [];
  const rows = Object.entries(all).flatMap(([path, list]) => list.map((b) => ({ path, b })));
  return (
    <>
      {available.map((f) => (
        <label key={f.filter} className="flex items-center gap-2 px-3 py-px text-[11.5px]">
          <input type="checkbox" checked={filters.includes(f.filter)} onChange={(e) => setExceptionFilters(e.target.checked ? [...filters, f.filter] : filters.filter((x) => x !== f.filter))} />
          {f.label}
        </label>
      ))}
      {rows.length === 0 ? <div className="px-3 py-1 text-[11px] text-muted-foreground">Click in the gutter left of a line number to add one</div> : null}
      {rows.map(({ path, b }) => (
        <div key={`${path}:${b.line}`} className="group flex items-center gap-2 px-3 py-px text-[11.5px] hover:bg-muted/50">
          <input type="checkbox" checked={b.enabled} onChange={(e) => setBreakpointEnabled(path, b.line, e.target.checked)} />
          <button type="button" className="min-w-0 flex-1 truncate text-left" title={path} onClick={() => app().openFile(path, b.line)}>
            <span>{path.replace(/^.*\//, "")}</span>
            <span className="text-muted-foreground">:{b.line}</span>
            {b.condition ? <span className="ml-1 text-amber-600 dark:text-amber-400">if {b.condition}</span> : null}
            {b.hitCondition ? <span className="ml-1 text-amber-600 dark:text-amber-400">hits {b.hitCondition}</span> : null}
            {b.logMessage ? <span className="ml-1 text-sky-600 dark:text-sky-400">log “{b.logMessage}”</span> : null}
          </button>
          <button type="button" className="opacity-0 group-hover:opacity-100" title="Remove" onClick={() => removeBreakpoint(path, b.line)}>
            ✕
          </button>
        </div>
      ))}
    </>
  );
}

function ConsoleView() {
  const lines = useDebugStore((s) => s.console);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  const color = (c: string) => (c === "stderr" ? "text-red-600 dark:text-red-400" : c === "input" ? "text-muted-foreground" : c === "result" ? "text-sky-700 dark:text-sky-300" : c === "console" ? "text-muted-foreground italic" : "");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={ref} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-2 py-1 font-mono text-[11.5px] leading-snug">
        {lines.map((l) => (
          <span key={l.id} className={color(l.category)}>
            {l.text}
          </span>
        ))}
      </div>
      <input
        className="m-1.5 rounded border border-border/60 bg-background px-2 py-1 font-mono text-[11.5px]"
        placeholder="Evaluate in the paused frame (↑ for history)"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && input.trim()) {
            void replEvaluate(input.trim());
            setHistory((h) => [input.trim(), ...h.filter((x) => x !== input.trim())].slice(0, 100));
            setHIdx(-1);
            setInput("");
          } else if (e.key === "ArrowUp" && history.length) {
            const i = Math.min(hIdx + 1, history.length - 1);
            setHIdx(i);
            setInput(history[i]);
            e.preventDefault();
          } else if (e.key === "ArrowDown") {
            const i = Math.max(hIdx - 1, -1);
            setHIdx(i);
            setInput(i < 0 ? "" : history[i]);
            e.preventDefault();
          }
        }}
      />
    </div>
  );
}

export function DebugPanel() {
  const sessions = useDebugStore((s) => s.sessions);
  const activeId = useDebugStore((s) => s.activeId);
  const starting = useDebugStore((s) => s.starting);
  const lastConfig = useDebugStore((s) => s.lastConfig);
  const selectedFrameId = useDebugStore((s) => s.selectedFrameId);
  const bpCount = useDebugStore((s) => Object.values(s.breakpoints).reduce((n, l) => n + l.length, 0));
  const entry = sessions.find((e) => e.id === activeId) ?? null;
  const live = entry && entry.state.status !== "ended";
  const paused = entry?.state.status === "stopped";
  const status = useMemo(() => {
    if (starting) return "Starting…";
    if (!entry) return "Not debugging";
    if (entry.state.status === "stopped") return `Paused${entry.state.stopReason ? ` on ${entry.state.stopReason}` : ""}${entry.state.stopDescription ? ` — ${entry.state.stopDescription}` : ""}`;
    if (entry.state.status === "running") return "Running";
    if (entry.state.status === "starting") return "Starting…";
    return "Ended";
  }, [entry, starting]);

  const pickAndStart = async () => {
    const cfgs = await configurations();
    const pick = await quickPick(
      [...cfgs.map((c) => ({ label: c.label, description: c.description, value: c.config as unknown })), { label: "Open / create .vscode/launch.json", value: "launch.json" as unknown }],
      { title: "Debug configuration", emptyText: "No configurations" },
    );
    if (pick === "launch.json") return void window.dispatchEvent(new CustomEvent("gear:open-launch-json"));
    if (pick) void startDebugging(await resolveForWorkspace(pick as Parameters<typeof resolveForWorkspace>[0]));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/40 px-2">
        <span className="mr-1 text-[11.5px] font-semibold">Debug</span>
        {!live ? (
          <>
            <IconBtn label="Start debugging (F5)" onClick={() => void startOrContinue()} disabled={starting} className="text-green-600 dark:text-green-400">
              ▶
            </IconBtn>
            <button type="button" className="min-w-0 truncate rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted" onClick={() => void pickAndStart()} title="Choose a configuration">
              {lastConfig?.name ?? "Choose configuration…"} ▾
            </button>
          </>
        ) : (
          <>
            {paused ? (
              <IconBtn label="Continue (F5)" onClick={() => void debugCommand.continue()} className="text-green-600 dark:text-green-400">
                ▶
              </IconBtn>
            ) : (
              <IconBtn label="Pause (F6)" onClick={() => void debugCommand.pause()}>
                ⏸
              </IconBtn>
            )}
            <IconBtn label="Step over (F10)" onClick={() => void debugCommand.next()} disabled={!paused}>
              ↷
            </IconBtn>
            <IconBtn label="Step into (F11)" onClick={() => void debugCommand.stepIn()} disabled={!paused}>
              ↓
            </IconBtn>
            <IconBtn label="Step out (Shift+F11)" onClick={() => void debugCommand.stepOut()} disabled={!paused}>
              ↑
            </IconBtn>
            <IconBtn label="Restart (Ctrl+Shift+F5)" onClick={() => void restartDebugging()}>
              ⟲
            </IconBtn>
            <IconBtn label="Stop (Shift+F5)" onClick={() => void stopDebugging()} className="text-red-600 dark:text-red-400">
              ■
            </IconBtn>
          </>
        )}
      </div>
      {sessions.length > 1 ? (
        <select className="mx-2 mt-1 rounded border bg-background px-1 py-0.5 text-[11px]" value={activeId ?? ""} onChange={(e) => useDebugStore.setState({ activeId: Number(e.target.value) })}>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.parentId ? "↳ " : ""}
              {s.name} — {s.state.status}
            </option>
          ))}
        </select>
      ) : null}
      <div className={cn("shrink-0 px-3 py-1 text-[11px]", paused ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>{status}</div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Section title="Variables">
          <ScopesView frameId={selectedFrameId} />
        </Section>
        <Section title="Watch" count={useDebugStore.getState().watches.length || undefined}>
          <Watches />
        </Section>
        <Section title="Call stack" count={entry?.state.frames.length || undefined}>
          <CallStack />
        </Section>
        <Section
          title="Breakpoints"
          count={bpCount || undefined}
          actions={
            <button type="button" className="text-[10px] normal-case hover:underline" onClick={removeAllBreakpoints}>
              Remove all
            </button>
          }
        >
          <Breakpoints />
        </Section>
      </div>
      <div className="flex h-[38%] min-h-[140px] shrink-0 flex-col border-t border-border/40">
        <div className="flex h-6 shrink-0 items-center px-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
          Debug console
          <button type="button" className="ml-auto font-normal normal-case hover:underline" onClick={clearConsole}>
            Clear
          </button>
        </div>
        <ConsoleView />
      </div>
    </div>
  );
}
