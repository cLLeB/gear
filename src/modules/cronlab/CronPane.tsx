// gear-cron://: write a cron expression and see what it means, when it runs
// next, and what is wrong with it when it does not parse.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { toolPaneHandle } from "@/modules/tools/paneHandle";
import { describe, FIELDS, nextRuns, parseCron, PRESETS, runsPerDay, warning } from "./model";

export const CRON_PATH = "gear-cron://Cron";
const KEY = "gear.cronlab";
let seed = "";

/** Opens the workbench; a selected expression in the editor is taken over. */
export function openCronLab(): void {
  const view = getActiveEditor()?.view;
  const sel = view ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to).trim() : "";
  // Quotes around the expression (YAML, JSON) are dropped.
  const expr = sel.replace(/^["']|["']$/g, "");
  if (expr && expr.length < 80 && parseCron(expr).cron) seed = expr;
  app().openFile(CRON_PATH);
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const HINTS = ["0–59", "0–23", "1–31", "1–12 or JAN–DEC", "0–6 or SUN–SAT (7 is Sunday too)"];

function relative(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return "in under a minute";
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `in ${h} h ${m % 60} min`;
  const d = Math.floor(h / 24);
  return d < 60 ? `in ${d} days` : `in ${Math.round(d / 30.44)} months`;
}

export const CronPane = forwardRef<EditorPaneHandle, { path: string }>(function CronPane({ path }, ref) {
  const [expr, setExprState] = useState(() => {
    if (seed) return seed;
    try {
      return localStorage.getItem(KEY) || "*/15 9-17 * * 1-5";
    } catch {
      return "*/15 9-17 * * 1-5";
    }
  });
  const [utc, setUtc] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const setExpr = (v: string) => {
    setExprState(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      // Not remembered, then.
    }
  };

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  useImperativeHandle(ref, () => toolPaneHandle(path, { getSelection: () => expr }), [path, expr]);

  const parsed = useMemo(() => parseCron(expr), [expr]);
  const runs = useMemo(() => (parsed.cron ? nextRuns(parsed.cron, now, 12, utc) : []), [parsed, now, utc]);
  const parts = expr.trim().startsWith("@") ? (parsed.cron?.source ?? []) : expr.trim().split(/\s+/);
  const perDay = parsed.cron ? runsPerDay(parsed.cron) : 0;
  const warn = parsed.cron ? warning(parsed.cron) : null;
  const badField = parsed.cron ? null : parsed.field;

  const setField = (i: number, value: string) => {
    const base = parsed.cron ? [...parsed.cron.source] : [...parts, "*", "*", "*", "*", "*"].slice(0, 5);
    base[i] = value.trim() || "*";
    setExpr(base.join(" "));
  };

  const fmt = (d: Date) => (utc ? `${d.toISOString().slice(0, 16).replace("T", " ")} UTC` : d.toLocaleString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));

  return (
    <div className="flex h-full flex-col overflow-auto text-[12.5px]">
      <div className="space-y-2 border-b border-border/60 p-3">
        <input className={cn("w-full rounded border bg-background px-3 py-2 font-mono text-[18px] outline-none focus:border-ring", parsed.cron ? "border-border/60" : "border-red-500")} data-cron-expr value={expr} spellCheck={false} placeholder="minute hour day-of-month month day-of-week" onChange={(e) => setExpr(e.target.value)} />
        {parsed.cron ? (
          <div className="text-[15px] font-medium" data-cron-description>
            {describe(parsed.cron)}
          </div>
        ) : (
          <div className="text-[13.5px] text-red-500" data-cron-error>
            {parsed.error}
          </div>
        )}
        {warn && (
          <div className="rounded bg-amber-500/10 px-2 py-1 text-amber-600" data-cron-warning>
            {warn}
          </div>
        )}
        <div className="grid grid-cols-5 gap-2">
          {FIELDS.map((f, i) => (
            <label key={f.name} className="block">
              <span className="mb-0.5 block text-muted-foreground">{f.name}</span>
              <input className={cn("w-full rounded border bg-background px-2 py-1 font-mono outline-none focus:border-ring", badField === i ? "border-red-500" : "border-border/60")} data-cron-field={i} value={parts[i] ?? ""} spellCheck={false} onChange={(e) => setField(i, e.target.value)} />
              <span className="mt-0.5 block text-[10.5px] text-muted-foreground">{HINTS[i]}</span>
            </label>
          ))}
        </div>
        <div className="text-muted-foreground">
          <code>*</code> any value · <code>,</code> a list (1,15) · <code>-</code> a range (1-5) · <code>/</code> a step (*/10 is every 10th)
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-wrap">
        <div className="min-w-[320px] flex-1 border-r border-border/60 p-3">
          <div className="mb-1 flex items-center gap-2">
            <span className="font-medium">Next runs</span>
            <span className="flex-1" />
            <button type="button" className={cn(btn, !utc && "bg-muted font-medium")} onClick={() => setUtc(false)}>
              Local time
            </button>
            <button type="button" className={cn(btn, utc && "bg-muted font-medium")} title="GitHub Actions and most cloud schedulers use UTC" onClick={() => setUtc(true)}>
              UTC
            </button>
          </div>
          {parsed.cron && runs.length === 0 && <div className="text-muted-foreground">This schedule never runs in the next twelve years.</div>}
          {runs.map((d, i) => (
            <div key={d.getTime()} className="flex justify-between gap-4 border-b border-border/30 py-0.5" data-cron-run>
              <span className="font-mono tabular-nums">{fmt(d)}</span>
              <span className="text-muted-foreground">{i === 0 ? relative(d.getTime() - now.getTime()) : ""}</span>
            </div>
          ))}
          {parsed.cron && (
            <div className="mt-2 text-muted-foreground" data-cron-rate>
              About {perDay >= 1 ? `${Math.round(perDay).toLocaleString()} runs a day` : perDay * 7 >= 1 ? `${Math.round(perDay * 7)} runs a week` : perDay * 30.44 >= 1 ? `${Math.round(perDay * 30.44)} runs a month` : `${Math.max(1, Math.round(perDay * 365.25))} runs a year`}.
            </div>
          )}
          <div className="mt-2 flex gap-1.5">
            <button type="button" className={btn} disabled={!parsed.cron} onClick={() => void navigator.clipboard.writeText(expr.trim()).then(() => toast.success("Expression copied"))}>
              Copy expression
            </button>
            <button
              type="button"
              className={btn}
              disabled={!parsed.cron}
              title="Insert at the cursor of the last editor"
              onClick={() => {
                const view = getActiveEditor()?.view;
                if (!view) return void toast.info("Open a file first.");
                view.dispatch(view.state.replaceSelection(expr.trim()));
                toast.success("Inserted");
              }}
            >
              Insert in editor
            </button>
          </div>
        </div>
        <div className="w-[340px] shrink-0 p-3">
          <div className="mb-1 font-medium">Common schedules</div>
          {PRESETS.map((p) => (
            <button key={p.expr} type="button" data-preset={p.expr} className={cn("flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left hover:bg-muted/50", expr.trim() === p.expr && "bg-muted")} onClick={() => setExpr(p.expr)}>
              <span className="min-w-0 flex-1 truncate">{p.label}</span>
              <code className="shrink-0 text-[11.5px] text-muted-foreground">{p.expr}</code>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});

export const CRON_ACTIONS = [{ id: "cron.open", label: "Cron: Open the cron workbench", keywords: ["cron", "crontab", "schedule", "next runs", "github actions schedule", "cronjob", "timer"], run: openCronLab }];
