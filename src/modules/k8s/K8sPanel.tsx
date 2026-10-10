// The Kubernetes sidebar view: context and namespace pickers, resource kinds,
// a filterable list with kubectl-style status, and per-row actions.

import { useEffect, useState } from "react";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { quickPick } from "@/modules/quick-pick";
import { decodeSecret, KINDS, type Row } from "./model";
import { describe, editYaml, init, kindInfo, openLogs, openShell, portForward, refresh, remove, restart, scale, setScope, stopForward, triggerCronJob, useK8sStore } from "./store";

const HEALTH: Record<string, string> = { ok: "bg-emerald-500", warn: "bg-amber-500", error: "bg-destructive", idle: "bg-muted-foreground/40" };
const btn = "rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground";
const select = "min-w-0 flex-1 truncate rounded border border-border/60 bg-background px-1 py-0.5 text-[11.5px]";

async function rowMenu(kind: string, r: Row): Promise<void> {
  const info = kindInfo(kind);
  const items: { label: string; detail?: string; value: () => unknown }[] = [
    ...(kind === "pods"
      ? [
          { label: "Logs", value: () => openLogs(r) },
          { label: "Shell", value: () => openShell(r) },
        ]
      : []),
    ...(kind === "pods" || kind === "services" || kind === "deployments" ? [{ label: "Port-forward…", value: () => portForward(kind, r) }] : []),
    { label: "Describe", value: () => describe(kind, r) },
    ...(kind !== "events" ? [{ label: "Edit YAML", detail: "Saving applies it (kubectl replace)", value: () => editYaml(kind, r) }] : []),
    ...(info.scalable ? [{ label: "Scale…", value: () => scale(kind, r) }] : []),
    ...(info.restartable ? [{ label: "Rollout restart", value: () => restart(kind, r) }] : []),
    ...(kind === "cronjobs" ? [{ label: "Run now", detail: "kubectl create job --from=cronjob", value: () => triggerCronJob(r) }] : []),
    ...(kind === "secrets" ? [{ label: "Show decoded values", value: () => showSecret(r) }] : []),
    { label: "Copy name", value: () => navigator.clipboard.writeText(r.name) },
    ...(kind !== "events" ? [{ label: "Delete…", value: () => remove(kind, r) }] : []),
  ];
  const pick = await quickPick(items, { title: `${kind}/${r.name}${r.namespace ? ` · ${r.namespace}` : ""}` });
  void pick?.();
}

async function showSecret(r: Row): Promise<void> {
  const values = decodeSecret(r.raw);
  const pick = await quickPick(values.map(([k, v]) => ({ label: k, detail: v.length > 200 ? `${v.slice(0, 200)}…` : v, value: v })), { title: `${r.name} (click to copy)` });
  if (pick !== undefined) await navigator.clipboard.writeText(pick);
}

export function K8sPanel() {
  const s = useK8sStore();
  const [filter, setFilter] = useState("");
  useEffect(() => {
    void init();
    const t = window.setInterval(() => document.visibilityState === "visible" && useK8sStore.getState().available && void refresh(), 8000);
    return () => window.clearInterval(t);
  }, []);
  const info = kindInfo(s.kind);
  const q = filter.toLowerCase();
  const rows = q ? s.rows.filter((r) => `${r.name} ${r.namespace ?? ""} ${r.status} ${r.detail}`.toLowerCase().includes(q)) : s.rows;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/40 px-2">
        <span className="text-[11.5px] font-semibold">Kubernetes</span>
        <span className="flex-1" />
        <button type="button" className={btn} title="Refresh" onClick={() => void refresh()}>
          {s.loading ? "…" : "⟳"}
        </button>
      </div>
      {s.available === false || s.error ? (
        <div className="p-3 text-[11.5px] text-muted-foreground">
          <div className="text-destructive">{s.error ?? "kubectl isn't available"}</div>
          <button type="button" className="mt-2 rounded border border-border/60 px-2 py-0.5 hover:bg-muted" onClick={() => void init()}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1 border-b border-border/40 p-2">
            <div className="flex gap-1">
              <select className={select} value={s.context ?? ""} onChange={(e) => setScope({ context: e.target.value })} title="Context">
                {s.contexts.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              {info.namespaced && (
                <select className={select} value={s.namespace ?? ""} onChange={(e) => setScope({ namespace: e.target.value || null })} title="Namespace">
                  <option value="">All namespaces</option>
                  {[...new Set([...(s.namespace ? [s.namespace] : []), ...s.namespaces])].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex flex-wrap gap-0.5">
              {KINDS.map((k) => (
                <button key={k.id} type="button" className={cn("rounded px-1.5 py-0.5 text-[11px]", s.kind === k.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted")} onClick={() => setScope({ kind: k.id })}>
                  {k.label}
                </button>
              ))}
            </div>
            <input className="rounded border border-border/60 bg-background px-2 py-0.5 text-[12px]" placeholder={`Filter ${info.label.toLowerCase()}`} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {s.listError && <div className="p-2 text-[11px] text-destructive">{s.listError}</div>}
            {!s.listError && !rows.length && <div className="p-3 text-[11.5px] text-muted-foreground">{s.loading ? "Loading…" : `No ${info.label.toLowerCase()}.`}</div>}
            {rows.map((r) => (
              <div
                key={`${r.namespace}/${r.name}/${r.raw.metadata?.uid ?? ""}`}
                className="group flex cursor-pointer flex-col px-2 py-1 text-[12px] hover:bg-muted/50"
                onClick={() => (s.kind === "pods" ? void openLogs(r) : s.kind === "events" ? undefined : describe(s.kind, r))}
                onContextMenu={(e) => (e.preventDefault(), void rowMenu(s.kind, r))}
                title={r.detail}
              >
                <div className="flex items-center gap-1.5">
                  <span className={cn("size-2 shrink-0 rounded-full", HEALTH[r.health])} />
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  {r.ready && <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{r.ready}</span>}
                  {r.restarts ? <span className="shrink-0 text-[11px] text-amber-600" title="Restarts">↻{r.restarts}</span> : null}
                  <span className="w-8 shrink-0 text-right text-[11px] text-muted-foreground">{r.age}</span>
                  <button type="button" className={cn(btn, "opacity-0 group-hover:opacity-100")} onClick={(e) => (e.stopPropagation(), void rowMenu(s.kind, r))}>
                    ⋯
                  </button>
                </div>
                <div className="truncate pl-3.5 text-[11px] text-muted-foreground">
                  <span className={cn(r.health === "error" && "text-destructive", r.health === "warn" && "text-amber-600")}>{r.status}</span>
                  {!s.namespace && r.namespace ? ` · ${r.namespace}` : ""}
                  {r.detail ? ` · ${r.detail}` : ""}
                </div>
              </div>
            ))}
          </div>
          {s.forwards.length > 0 && (
            <div className="border-t border-border/40 p-2">
              {s.forwards.map((f) => (
                <div key={f.key} className="flex items-center gap-1.5 text-[12px]">
                  <span className={cn("size-2 rounded-full", f.status === "up" ? "bg-emerald-500" : f.status === "starting" ? "bg-amber-500" : "bg-destructive")} title={f.error} />
                  <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => app().openPreview(`http://localhost:${f.local}`)}>
                    localhost:{f.local} → {f.label}
                  </button>
                  <button type="button" className={btn} onClick={() => void stopForward(f.key)}>
                    Stop
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
