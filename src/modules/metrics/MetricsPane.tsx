// gear-metrics://<url or file>: a Prometheus / OpenMetrics endpoint browsed
// like a table — metric families with their help and type, every series
// with readable units, per-second rates between scrapes, histogram
// percentiles, label cardinality and naming problems.

import { appCacheDir } from "@tauri-apps/api/path";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { IS_WINDOWS } from "@/lib/platform";
import { quoteShellArg } from "@/lib/shellQuote";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { inputBox } from "@/modules/quick-pick";
import { base64ToBytes, copyToClipboard, formatBytes, toolPaneHandle, toolsNative } from "@/modules/tools/paneHandle";
import { formatNumber, histogramQuantile, humanize, lint, parseExposition, rate, seriesOf, type Exposition, type Family, type Series } from "./model";

const SCHEME = "gear-metrics://";
const READ_CAP = 64 * 1024 * 1024;
const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const TYPE_STYLE: Record<string, string> = {
  counter: "bg-sky-500/15 text-sky-600",
  gauge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  histogram: "bg-violet-500/15 text-violet-600",
  summary: "bg-fuchsia-500/15 text-fuchsia-600",
};
const LAST_KEY = "gear.metrics.lastUrl";

export function openMetricsFor(target: string): void {
  app().openFile(`${SCHEME}${target}`);
}

export async function openMetricsExplorer(): Promise<void> {
  let last = "http://localhost:9090/metrics";
  try {
    last = localStorage.getItem(LAST_KEY) ?? last;
  } catch {
    /* storage unavailable */
  }
  const target = (await inputBox({ title: "Explore Prometheus metrics", value: last, placeholder: "A /metrics URL, or a saved exposition file" }))?.trim();
  if (!target) return;
  try {
    localStorage.setItem(LAST_KEY, target);
  } catch {
    /* storage unavailable */
  }
  openMetricsFor(/^[a-z]+:\/\//i.test(target) || /\.(prom|txt|metrics)$/i.test(target) || /[\\/]/.test(target) ? target : `http://${target}`);
}

const isUrl = (t: string) => /^https?:\/\//i.test(t);

async function scrape(target: string): Promise<{ text: string; at: number }> {
  const at = Date.now();
  if (!isUrl(target)) {
    const r = await toolsNative.readBytes(target, READ_CAP);
    return { text: new TextDecoder().decode(base64ToBytes(r.data)), at };
  }
  const dir = `${(await appCacheDir()).replace(/\\/g, "/").replace(/\/+$/, "")}/metrics`;
  await native.createDir(dir).catch(() => {});
  const out = `${dir}/scrape.txt`;
  const curl = IS_WINDOWS ? "curl.exe" : "curl";
  const args = ["-sS", "--compressed", "-m", "20", "-H", "Accept: application/openmetrics-text;version=1.0.0,text/plain;version=0.0.4;q=0.5,*/*;q=0.1", "-o", out, "-w", "%{http_code}", target];
  const r = await native.runCommand(`${curl} ${args.map((a) => quoteShellArg(a)).join(" ")}`, null, 30);
  if (r.exit_code !== 0) throw new Error((r.stderr || "curl failed").trim());
  const status = Number(r.stdout.trim());
  const file = await toolsNative.readBytes(out, READ_CAP);
  const text = new TextDecoder().decode(base64ToBytes(file.data));
  if (status >= 400) throw new Error(`The endpoint answered ${status}: ${text.slice(0, 300)}`);
  return { text, at };
}

type Sort = "name" | "series";

export const MetricsPane = forwardRef<EditorPaneHandle, { path: string }>(function MetricsPane({ path }, ref) {
  const target = path.startsWith(SCHEME) ? path.slice(SCHEME.length) : path;
  const [exp, setExp] = useState<{ data: Exposition; at: number; bytes: number } | null>(null);
  const [prev, setPrev] = useState<{ data: Exposition; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [selected, setSelected] = useState<string | null>(null);
  const [showLint, setShowLint] = useState(false);
  const [auto, setAuto] = useState(0);
  const current = useRef(exp);
  current.current = exp;

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const { text: body, at } = await scrape(target);
      const data = parseExposition(body);
      if (!data.families.length && data.errors.length) throw new Error(`This does not look like Prometheus metrics: line ${data.errors[0].line}: ${data.errors[0].message}`);
      if (current.current) setPrev({ data: current.current.data, at: current.current.at });
      setExp({ data, at, bytes: body.length });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [target]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => void load(), auto * 1000);
    return () => clearInterval(t);
  }, [auto, load]);
  useImperativeHandle(ref, () => toolPaneHandle(path, { setQuery: setText, clearQuery: () => setText(""), reload: () => (void load(), true) }), [path, load]);

  const lints = useMemo(() => (exp ? lint(exp.data) : []), [exp]);
  const families = useMemo(() => {
    if (!exp) return [];
    const q = text.trim().toLowerCase();
    const list = exp.data.families.filter((f) => !q || f.name.toLowerCase().includes(q) || (f.help ?? "").toLowerCase().includes(q) || [...f.labels.keys()].some((l) => l.toLowerCase() === q));
    return sort === "series" ? [...list].sort((a, b) => b.series - a.series || a.name.localeCompare(b.name)) : [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [exp, text, sort]);
  const fam = useMemo(() => exp?.data.families.find((f) => f.name === selected) ?? families[0] ?? null, [exp, selected, families]);
  const prevSeries = useMemo(() => {
    const f = prev?.data.families.find((x) => x.name === fam?.name);
    return f ? new Map(seriesOf(f).map((s) => [s.key, s])) : null;
  }, [prev, fam]);

  if (error && !exp)
    return (
      <div className="space-y-2 p-6 text-[12.5px]">
        <div className="text-red-500" data-metrics-error>
          {error}
        </div>
        <button type="button" className={btn} onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  if (!exp) return <div className="p-6 text-[12.5px] text-muted-foreground">Scraping {target}…</div>;

  const totalSeries = exp.data.families.reduce((a, f) => a + f.series, 0);
  const seconds = prev ? (exp.at - prev.at) / 1000 : 0;

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-2">
        <span className="font-mono text-[12px]">{target}</span>
        <span className="text-muted-foreground" data-metrics-summary>
          {exp.data.families.length} metrics · {totalSeries.toLocaleString()} series · {exp.data.samples.toLocaleString()} samples · {formatBytes(exp.bytes)}
          {exp.data.openMetrics && " · OpenMetrics"} · {new Date(exp.at).toLocaleTimeString()}
        </span>
        {error && <span className="text-red-500">Last scrape failed: {error}</span>}
        <span className="flex-1" />
        <input className="w-48 rounded border border-border/60 bg-transparent px-2 py-0.5 text-[12px]" placeholder="Filter metrics or a label name…" value={text} onChange={(e) => setText(e.target.value)} />
        <select className="rounded border border-border/60 bg-transparent px-1 py-0.5 text-[12px]" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="name">By name</option>
          <option value="series">By series (cardinality)</option>
        </select>
        {isUrl(target) && (
          <select className="rounded border border-border/60 bg-transparent px-1 py-0.5 text-[12px]" value={auto} onChange={(e) => setAuto(Number(e.target.value))} title="Scrape again on a timer to see rates">
            <option value={0}>Manual</option>
            <option value={5}>Every 5 s</option>
            <option value={15}>Every 15 s</option>
            <option value={60}>Every minute</option>
          </select>
        )}
        <button type="button" className={cn(btn, showLint && "bg-primary/10")} onClick={() => setShowLint(!showLint)} data-metrics-lint>
          {lints.length} naming problem{lints.length === 1 ? "" : "s"}
        </button>
        <button type="button" className={btn} disabled={busy} onClick={() => void load()}>
          {busy ? "Scraping…" : isUrl(target) ? "Scrape again" : "Reload"}
        </button>
      </div>
      {exp.data.errors.length > 0 && (
        <div className="border-b border-border/60 bg-amber-500/10 px-3 py-1 text-amber-700 dark:text-amber-400">
          {exp.data.errors.length} unreadable line{exp.data.errors.length === 1 ? "" : "s"}, first at line {exp.data.errors[0].line}: {exp.data.errors[0].message}
        </div>
      )}
      {showLint && (
        <div className="max-h-48 overflow-auto border-b border-border/60 px-3 py-1.5">
          {lints.length === 0 && <div className="text-emerald-600">No problems found.</div>}
          {lints.map((l, i) => (
            <button key={i} type="button" className="block w-full truncate text-left hover:underline" onClick={() => setSelected(l.family)}>
              <span className="font-mono text-[11.5px]">{l.family}</span>: {l.message}
            </button>
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="w-80 shrink-0 overflow-auto border-r border-border/60">
          {families.map((f) => (
            <button key={f.name} type="button" data-metrics-family={f.name} className={cn("flex w-full items-baseline gap-1.5 px-2 py-0.5 text-left hover:bg-muted/50", fam?.name === f.name && "bg-primary/10")} onClick={() => setSelected(f.name)} title={f.help ?? undefined}>
              <span className={cn("w-14 shrink-0 rounded px-1 text-center text-[10px]", TYPE_STYLE[f.type] ?? "bg-muted text-muted-foreground")}>{f.type}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{f.name}</span>
              <span className={cn("shrink-0 text-[11px] tabular-nums", f.series > 100 ? "text-amber-600" : "text-muted-foreground")}>{f.series}</span>
            </button>
          ))}
          {families.length === 0 && <div className="p-2 text-muted-foreground">No metric matches.</div>}
        </div>
        <div className="min-w-0 flex-1 overflow-auto p-3">{fam && <FamilyView f={fam} prev={prevSeries} seconds={seconds} />}</div>
      </div>
    </div>
  );
});

function FamilyView({ f, prev, seconds }: { f: Family; prev: Map<string, Series> | null; seconds: number }) {
  const series = useMemo(() => seriesOf(f), [f]);
  const [labelFilter, setLabelFilter] = useState("");
  const labelNames = [...f.labels.keys()];
  const rows = series.filter((s) => !labelFilter || Object.entries(s.labels).some(([k, v]) => `${k}=${v}`.toLowerCase().includes(labelFilter.toLowerCase()))).slice(0, 2000);
  const isHist = f.type === "histogram" || f.type === "gaugehistogram";
  const counts = f.type === "counter" || f.type === "histogram" || f.type === "summary";
  const show = (n: number) => {
    const h = humanize(n, f);
    return h ? `${h}` : formatNumber(n);
  };
  const promql = (s: Series) => {
    const sel = Object.entries(s.labels).length ? `{${Object.entries(s.labels).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(",")}}` : "";
    if (isHist) return `histogram_quantile(0.99, sum by (le) (rate(${f.name}_bucket${sel}[5m])))`;
    if (f.type === "counter") return `rate(${f.samples[0]?.name ?? f.name}${sel}[5m])`;
    return `${f.name}${sel}`;
  };
  return (
    <div className="space-y-2">
      <div>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono font-medium">{f.name}</span>
          <span className={cn("rounded px-1 text-[10.5px]", TYPE_STYLE[f.type] ?? "bg-muted text-muted-foreground")}>{f.type}</span>
          {f.unit && <span className="text-[11px] text-muted-foreground">unit: {f.unit}</span>}
          <span className="text-[11px] text-muted-foreground">
            {f.series} series{prev && counts ? ` · rates over ${seconds.toFixed(1)} s` : counts ? " · scrape again to see rates" : ""}
          </span>
        </div>
        {f.help && <div className="mt-0.5 text-muted-foreground">{f.help}</div>}
      </div>
      {labelNames.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {labelNames.map((l) => (
            <span key={l} className={cn("rounded px-1 text-[11px]", (f.labels.get(l) ?? 0) > 100 ? "bg-amber-500/15 text-amber-700" : "bg-muted")}>
              {l}: {f.labels.get(l)} value{f.labels.get(l) === 1 ? "" : "s"}
            </span>
          ))}
          <input className="ml-2 w-40 rounded border border-border/60 bg-transparent px-2 py-0.5 text-[11.5px]" placeholder="Filter label=value…" value={labelFilter} onChange={(e) => setLabelFilter(e.target.value)} />
        </div>
      )}
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-[11px] text-muted-foreground">
            <th className="py-0.5 pr-2 font-normal">Labels</th>
            <th className="px-2 text-right font-normal">{isHist || f.type === "summary" ? "Count" : "Value"}</th>
            {counts && prev && <th className="px-2 text-right font-normal">Per second</th>}
            {(isHist || f.type === "summary") && <th className="px-2 text-right font-normal">Average</th>}
            {isHist && (
              <>
                <th className="px-2 text-right font-normal">p50</th>
                <th className="px-2 text-right font-normal">p90</th>
                <th className="px-2 text-right font-normal">p99</th>
              </>
            )}
            {f.type === "summary" && <th className="px-2 text-right font-normal">Quantiles</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const p = prev?.get(s.key);
            const r = p && counts ? rate(p.value, s.value, seconds) : NaN;
            return (
              <tr key={s.key} className="align-top hover:bg-muted/40" data-metrics-series>
                <td className="py-0.5 pr-2 font-mono text-[11px]">
                  {Object.entries(s.labels).length ? (
                    Object.entries(s.labels).map(([k, v]) => (
                      <span key={k} className="mr-1.5 inline-block">
                        <span className="text-muted-foreground">{k}=</span>
                        {v}
                      </span>
                    ))
                  ) : (
                    <span className="text-muted-foreground">(no labels)</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 text-right tabular-nums" title={String(s.value)}>
                  {isHist || f.type === "summary" ? formatNumber(s.value) : show(s.value)}
                </td>
                {counts && prev && <td className="whitespace-nowrap px-2 text-right tabular-nums">{Number.isNaN(r) ? "—" : `${formatNumber(r)}/s`}</td>}
                {(isHist || f.type === "summary") && <td className="whitespace-nowrap px-2 text-right tabular-nums">{s.sum !== null && s.value > 0 ? show(s.sum / s.value) : "—"}</td>}
                {isHist &&
                  [0.5, 0.9, 0.99].map((q) => {
                    const v = histogramQuantile(q, s.buckets);
                    return (
                      <td key={q} className="whitespace-nowrap px-2 text-right tabular-nums" title="Estimated from the buckets, as histogram_quantile does (since the process started)">
                        {Number.isNaN(v) ? "—" : show(v)}
                      </td>
                    );
                  })}
                {f.type === "summary" && <td className="whitespace-nowrap px-2 text-right text-[11px] tabular-nums">{s.quantiles.map((q) => `p${+(q.q * 100).toFixed(2)} ${show(q.value)}`).join(" · ")}</td>}
                <td className="px-1 text-right">
                  <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => void copyToClipboard(promql(s)).then(() => toast.success("PromQL copied"))} title={promql(s)}>
                    PromQL
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {series.length > rows.length && !labelFilter && <div className="text-muted-foreground">Showing the first {rows.length} of {series.length} series; filter by label to see the rest.</div>}
    </div>
  );
}

export const METRICS_ACTIONS = [
  { id: "metrics.open", label: "Metrics: Explore a Prometheus /metrics endpoint…", keywords: ["prometheus", "metrics", "openmetrics", "exporter", "observability", "histogram", "cardinality", "promql", "scrape"], run: () => void openMetricsExplorer() },
];
