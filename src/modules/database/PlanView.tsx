// The query plan as a tree: each step with its rows (estimated vs actual),
// self time as a share of the query, cost, conditions and warnings; click a
// step for every property the engine reported.

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { flatten, hotspots, type Plan, type PlanNode } from "./plan";

function ms(v: number | null): string {
  return v === null ? "" : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : v >= 10 ? `${v.toFixed(0)} ms` : `${v.toFixed(2)} ms`;
}

function rows(n: number | null): string {
  return n === null ? "–" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(0)}k` : String(Math.round(n));
}

function heat(share: number): string {
  // Green → amber → red as a step's share of total time grows.
  return share > 0.5 ? "#ef4444" : share > 0.2 ? "#f59e0b" : share > 0.05 ? "#eab308" : "#22c55e";
}

export function PlanView({ plan, sql, onClose }: { plan: Plan; sql: string; onClose: () => void }) {
  const [selected, setSelected] = useState<PlanNode | null>(null);
  const items = useMemo(() => flatten(plan.root), [plan]);
  const total = plan.root.totalMs ?? plan.executionMs ?? 0;
  const hot = hotspots(plan);
  const warnings = items.flatMap((x) => x.node.warnings.map((w) => ({ w, n: x.node })));
  return (
    <div className="flex h-full flex-col text-[12px]">
      <div className="flex items-center gap-3 border-b border-border/60 px-3 py-1.5">
        <span className="font-medium">Query plan</span>
        {plan.analyzed ? (
          <span className="text-muted-foreground">
            executed in <b className="text-foreground">{ms(plan.executionMs ?? total)}</b>
            {plan.planningMs !== null ? ` · planned in ${ms(plan.planningMs)}` : ""}
          </span>
        ) : (
          <span className="text-muted-foreground">estimated (not executed) — use “Explain analyze” for real timings</span>
        )}
        {hot.length > 0 && plan.analyzed && (
          <span className="truncate text-muted-foreground">
            slowest:{" "}
            {hot.map((h) => (
              <button key={h.id} type="button" className="mr-2 text-foreground hover:underline" onClick={() => setSelected(h)}>
                {h.label} {h.detail.split(" ").slice(0, 2).join(" ")} ({total ? Math.round(((h.selfMs ?? 0) / total) * 100) : 0}%)
              </button>
            ))}
          </span>
        )}
        <span className="flex-1" />
        <button type="button" className="rounded px-2 py-0.5 hover:bg-muted" onClick={onClose}>
          Back to results
        </button>
      </div>
      {warnings.length > 0 && (
        <div className="max-h-28 shrink-0 overflow-auto border-b border-border/60 bg-amber-500/5 px-3 py-1">
          {warnings.map(({ w, n }, i) => (
            <button key={i} type="button" className="block w-full truncate text-left text-[11.5px] text-amber-700 hover:underline dark:text-amber-400" onClick={() => setSelected(n)}>
              ⚠ {w}
            </button>
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto py-1">
          {items.map(({ node: n, depth }) => {
            const share = total && n.selfMs !== null ? n.selfMs / total : 0;
            const e = Math.max(n.estRows ?? 1, 1);
            const a = Math.max(n.actualRows ?? 1, 1);
            const off = n.estRows !== null && n.actualRows !== null && Math.max(e / a, a / e) >= 10;
            return (
              <div key={n.id} className={cn("flex cursor-pointer items-start gap-2 px-3 py-0.5 hover:bg-muted/40", selected?.id === n.id && "bg-primary/10")} onClick={() => setSelected(n)}>
                <div className="min-w-0 flex-1" style={{ paddingLeft: depth * 16 }}>
                  <div className="flex items-center gap-1.5">
                    {depth > 0 && <span className="text-muted-foreground">└</span>}
                    <span className="font-medium">{n.label}</span>
                    {n.detail && <span className="truncate text-muted-foreground">{n.detail}</span>}
                    {n.warnings.length > 0 && <span className="text-amber-500" title={n.warnings.join("\n")}>⚠</span>}
                  </div>
                  {n.conditions.map((c) => (
                    <div key={c} className="truncate pl-4 font-mono text-[11px] text-muted-foreground" title={c}>
                      {c}
                    </div>
                  ))}
                </div>
                <div className="flex shrink-0 items-center gap-3 tabular-nums">
                  <span className={cn("w-28 text-right", off && "text-red-500")} title="estimated → actual rows">
                    {n.actualRows !== null ? `${rows(n.estRows)} → ${rows(n.actualRows)}` : rows(n.estRows)}
                  </span>
                  {n.loops > 1 && <span className="w-14 text-right text-muted-foreground">×{rows(n.loops)}</span>}
                  {plan.analyzed ? (
                    <span className="flex w-36 items-center justify-end gap-1.5">
                      <span className="relative h-1.5 w-14 rounded bg-muted">
                        <span className="absolute inset-y-0 left-0 rounded" style={{ width: `${Math.min(100, share * 100)}%`, background: heat(share) }} />
                      </span>
                      <span className="w-16 text-right">{ms(n.selfMs)}</span>
                    </span>
                  ) : (
                    n.cost !== null && <span className="w-20 text-right text-muted-foreground">cost {n.cost.toFixed(0)}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {selected && (
          <div className="w-80 shrink-0 overflow-auto border-l border-border/60 p-2">
            <div className="mb-1 font-medium">{selected.label}</div>
            {selected.warnings.map((w) => (
              <div key={w} className="mb-1 rounded bg-amber-500/10 p-1 text-[11.5px] text-amber-700 dark:text-amber-400">
                {w}
              </div>
            ))}
            <table className="w-full text-[11.5px]">
              <tbody>
                {[["Self time", ms(selected.selfMs)], ["Total time", ms(selected.totalMs)], ["Loops", String(selected.loops)], ...selected.props].filter(([, v]) => v !== "").map(([k, v]) => (
                  <tr key={k} className="border-b border-border/30 align-top">
                    <td className="py-0.5 pr-2 text-muted-foreground">{k}</td>
                    <td className="break-all py-0.5 font-mono">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="truncate border-t border-border/60 px-3 py-0.5 font-mono text-[11px] text-muted-foreground" title={sql}>
        {sql}
      </div>
    </div>
  );
}
