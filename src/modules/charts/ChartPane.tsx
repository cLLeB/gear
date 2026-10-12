// gear-chart://<file>: plot the columns of a CSV / TSV / JSON file as a line,
// bar, scatter or histogram chart, and copy or save the picture.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { app, frontFilePath } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { numeric } from "@/modules/table/model";
import { toolPaneHandle } from "@/modules/tools/paneHandle";
import { aggregate, bins, columnKind, formatDate, formatTick, linePath, loadTable, niceTicks, PALETTE, points, scale, stats, suggest, trend, type Aggregate, type ChartType, type Kind, type Table } from "./model";

const SCHEME = "gear-chart://";
const W = 900;
const H = 460;
const M = { left: 64, right: 20, top: 16, bottom: 56 };

export function openChartFor(file: string): void {
  app().openFile(`${SCHEME}${file}`);
}

export function openChartForActive(): void {
  const file = frontFilePath() ?? getActiveEditor()?.path ?? null;
  if (!file || !/\.(csv|tsv|psv|tab|json|geojson)$/i.test(file)) return void toast.info("Open a .csv, .tsv or .json file first.");
  openChartFor(file);
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const select = "rounded border border-border/60 bg-background px-1.5 py-0.5 text-[12px]";
const TYPES: { id: ChartType; label: string }[] = [
  { id: "line", label: "Line" },
  { id: "bar", label: "Bar" },
  { id: "scatter", label: "Scatter" },
  { id: "histogram", label: "Histogram" },
];

function Axes({ xTicks, yTicks, sx, sy, xLabel, yLabel }: { xTicks: { v: number; label: string }[]; yTicks: number[]; sx: (v: number) => number; sy: (v: number) => number; xLabel: string; yLabel: string }) {
  return (
    <g className="text-muted-foreground" fontSize={11}>
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} stroke="currentColor" strokeOpacity={0.15} />
          <text x={M.left - 8} y={sy(t) + 4} textAnchor="end" fill="currentColor">
            {formatTick(t)}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={`x${t.v}`} x={sx(t.v)} y={H - M.bottom + 16} textAnchor="middle" fill="currentColor">
          {t.label}
        </text>
      ))}
      <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} stroke="currentColor" strokeOpacity={0.5} />
      <line x1={M.left} x2={M.left} y1={M.top} y2={H - M.bottom} stroke="currentColor" strokeOpacity={0.5} />
      <text x={(M.left + W - M.right) / 2} y={H - 10} textAnchor="middle" fill="currentColor" fontSize={12}>
        {xLabel}
      </text>
      <text transform={`translate(14 ${(M.top + H - M.bottom) / 2}) rotate(-90)`} textAnchor="middle" fill="currentColor" fontSize={12}>
        {yLabel}
      </text>
    </g>
  );
}

export const ChartPane = forwardRef<EditorPaneHandle, { path: string }>(function ChartPane({ path }, ref) {
  const file = path.slice(SCHEME.length);
  const [table, setTable] = useState<Table | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<ChartType>("line");
  const [x, setX] = useState(0);
  const [ys, setYs] = useState<number[]>([]);
  const [how, setHow] = useState<Aggregate>("sum");
  const [showTrend, setShowTrend] = useState(false);
  const [zero, setZero] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const load = useCallback(
    async (keep = false) => {
      const r = await native.readFile(file).catch((e) => ({ kind: "error" as const, message: String(e) }));
      if (r.kind !== "text") return void setError(r.kind === "error" ? r.message : r.kind === "toolarge" ? "This file is too large to chart." : "This file is not text.");
      const t = loadTable(r.content, file);
      if (typeof t === "string") return void setError(t);
      setError(null);
      setTable(t);
      if (!keep) {
        const s = suggest(t);
        setType(s.type);
        setX(s.x);
        setYs(s.ys);
      }
    },
    [file],
  );

  useEffect(() => void load(), [load]);
  useImperativeHandle(ref, () => toolPaneHandle(path, { reload: () => (void load(true), true) }), [path, load]);

  const kinds = useMemo<Kind[]>(() => (table ? table.columns.map((_, i) => columnKind(table.rows, i)) : []), [table]);
  const numericCols = useMemo(() => kinds.map((k, i) => (k === "number" ? i : -1)).filter((i) => i >= 0), [kinds]);

  const chart = useMemo(() => {
    if (!table) return null;
    const plotW = [M.left, W - M.right] as const;
    const plotH = [H - M.bottom, M.top] as const;
    const yCols = ys.filter((c) => c < table.columns.length);
    if (type === "histogram") {
      const col = yCols[0] ?? x;
      const values = table.rows.map((r) => numeric(r[col] ?? "")).filter((v): v is number => v !== null);
      const b = bins(values);
      if (!b.length) return { empty: "This column has no numbers to count." };
      const yTicks = niceTicks(0, Math.max(...b.map((k) => k.count)));
      const sx = scale(b[0].from, b[b.length - 1].to, ...plotW);
      const sy = scale(0, yTicks[yTicks.length - 1], ...plotH);
      const xTicks = niceTicks(b[0].from, b[b.length - 1].to, 7).filter((t) => t >= b[0].from && t <= b[b.length - 1].to);
      return { kind: "histogram" as const, bins: b, sx, sy, yTicks, xTicks: xTicks.map((v) => ({ v, label: formatTick(v) })), xLabel: table.columns[col], yLabel: "count", summary: stats(values) };
    }
    if (!yCols.length) return { empty: "Choose at least one column of numbers for the vertical axis." };
    if (type === "bar") {
      const groups = aggregate(table.rows, x, yCols[0], how).slice(0, 60);
      if (!groups.length) return { empty: "Nothing to plot." };
      const lo = Math.min(0, ...groups.map((g) => g.value));
      const yTicks = niceTicks(lo, Math.max(0, ...groups.map((g) => g.value)));
      const sy = scale(yTicks[0], yTicks[yTicks.length - 1], ...plotH);
      const band = (plotW[1] - plotW[0]) / groups.length;
      const every = Math.ceil(groups.length / 14);
      return { kind: "bar" as const, groups, sy, yTicks, band, xTicks: groups.map((g, i) => ({ v: i, label: i % every === 0 ? (g.label.length > 12 ? `${g.label.slice(0, 11)}…` : g.label) : "" })), sx: (i: number) => plotW[0] + band * (i + 0.5), xLabel: table.columns[x], yLabel: `${how} of ${table.columns[yCols[0]]}`, summary: stats(groups.map((g) => g.value)) };
    }
    const xKind = kinds[x] ?? "text";
    const series = yCols.map((c) => ({ column: c, name: table.columns[c], pts: points(table.rows, x, c, xKind, type === "line") }));
    const all = series.flatMap((s) => s.pts);
    if (!all.length) return { empty: "These columns have no rows where both values are present." };
    const xs = all.map((p) => p.x);
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const yTicks = niceTicks(zero ? Math.min(0, ...all.map((p) => p.y)) : Math.min(...all.map((p) => p.y)), Math.max(...all.map((p) => p.y)));
    const sx = scale(x0, x1 === x0 ? x0 + 1 : x1, ...plotW);
    const sy = scale(yTicks[0], yTicks[yTicks.length - 1], ...plotH);
    const xTicks =
      xKind === "date"
        ? Array.from({ length: 7 }, (_, i) => x0 + ((x1 - x0) * i) / 6).map((v) => ({ v, label: formatDate(v, x1 - x0) }))
        : xKind === "number"
          ? niceTicks(x0, x1, 7).filter((t) => t >= x0 && t <= x1).map((v) => ({ v, label: formatTick(v) }))
          : niceTicks(x0, x1, 7).filter((t) => Number.isInteger(t) && t >= x0 && t <= x1).map((v) => ({ v, label: (table.rows[v]?.[x] ?? "").slice(0, 10) }));
    const fit = showTrend && xKind !== "text" ? trend(series[0].pts) : null;
    return { kind: type, series, sx, sy, yTicks, xTicks, xLabel: table.columns[x], yLabel: series.length === 1 ? series[0].name : "", fit, x0, x1, summary: stats(series[0].pts.map((p) => p.y)) };
  }, [table, type, x, ys, how, kinds, showTrend, zero]);

  const svgText = () => {
    const el = svgRef.current;
    if (!el) return "";
    const color = getComputedStyle(el).color;
    return new XMLSerializer().serializeToString(el).replace(/currentColor/g, color).replace("<svg", '<svg style="background:white"');
  };

  const copyPng = async () => {
    try {
      const img = new Image();
      const url = URL.createObjectURL(new Blob([svgText().replace(/currentColor/g, "#444")], { type: "image/svg+xml" }));
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("could not draw the chart"));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = W * 2;
      canvas.height = H * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      if (!blob) throw new Error("could not make the image");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast.success("Chart copied as an image");
    } catch (err) {
      toast.error(`Could not copy the chart: ${String(err)}`);
    }
  };

  const saveSvg = async () => {
    const target = `${file.replace(/\.[^.\\/]+$/, "")}-chart.svg`;
    try {
      await native.writeFile(target, svgText(), "user");
      toast.success(`Saved ${target.split(/[\\/]/).pop()}`);
    } catch (err) {
      toast.error(`Could not save: ${String(err)}`);
    }
  };

  if (error) return <div className="p-6 text-[12.5px] text-red-500">{error}</div>;
  if (!table) return <div className="p-6 text-[12.5px] text-muted-foreground">Reading the file…</div>;

  const toggleY = (c: number) => setYs(type === "line" || type === "scatter" ? (ys.includes(c) ? ys.filter((v) => v !== c) : [...ys, c]) : [c]);

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/60 p-2">
        <div className="flex gap-1">
          {TYPES.map((t) => (
            <button key={t.id} type="button" data-chart-type={t.id} className={cn(btn, type === t.id && "bg-muted font-medium")} onClick={() => (setType(t.id), t.id === "bar" || t.id === "histogram" ? setYs(ys.slice(0, 1).length ? ys.slice(0, 1) : numericCols.slice(0, 1)) : undefined)}>
              {t.label}
            </button>
          ))}
        </div>
        {type !== "histogram" && (
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">{type === "bar" ? "Group by" : "Across"}</span>
            <select className={select} data-chart-x value={x} onChange={(e) => setX(Number(e.target.value))}>
              {table.columns.map((c, i) => (
                <option key={i} value={i}>
                  {c} ({kinds[i]})
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-muted-foreground">{type === "histogram" ? "Column" : "Values"}</span>
          {numericCols.length === 0 && <span className="text-amber-600">no numeric columns</span>}
          {numericCols.map((c) => (
            <button key={c} type="button" data-chart-y={c} className={cn(btn, ys.includes(c) && "bg-muted font-medium")} style={ys.includes(c) ? { borderColor: PALETTE[ys.indexOf(c) % PALETTE.length] } : undefined} onClick={() => toggleY(c)}>
              {table.columns[c]}
            </button>
          ))}
        </div>
        {type === "bar" && (
          <select className={select} value={how} onChange={(e) => setHow(e.target.value as Aggregate)}>
            {(["sum", "mean", "count", "min", "max"] as Aggregate[]).map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        )}
        {(type === "line" || type === "scatter") && (
          <>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={showTrend} onChange={(e) => setShowTrend(e.target.checked)} />
              Trend line
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} />
              Start at zero
            </label>
          </>
        )}
        <span className="flex-1" />
        <button type="button" className={btn} onClick={() => void copyPng()}>
          Copy image
        </button>
        <button type="button" className={btn} onClick={() => void saveSvg()}>
          Save SVG
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {chart && "empty" in chart ? (
          <div className="p-6 text-muted-foreground" data-chart-empty>
            {chart.empty}
          </div>
        ) : chart ? (
          <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H}`} className="mx-auto w-full max-w-[1100px] text-foreground" data-chart={chart.kind} fontFamily="system-ui, sans-serif">
            <Axes xTicks={chart.xTicks} yTicks={chart.yTicks} sx={chart.sx} sy={chart.sy} xLabel={chart.xLabel} yLabel={chart.yLabel} />
            {chart.kind === "histogram" && chart.bins.map((b, i) => <rect key={i} x={chart.sx(b.from) + 1} width={Math.max(1, chart.sx(b.to) - chart.sx(b.from) - 2)} y={chart.sy(b.count)} height={chart.sy(0) - chart.sy(b.count)} fill={PALETTE[0]}><title>{`${formatTick(b.from)} – ${formatTick(b.to)}: ${b.count}`}</title></rect>)}
            {chart.kind === "bar" &&
              chart.groups.map((g, i) => (
                <rect key={i} x={chart.sx(i) - chart.band * 0.36} width={chart.band * 0.72} y={Math.min(chart.sy(g.value), chart.sy(0))} height={Math.abs(chart.sy(g.value) - chart.sy(0))} fill={PALETTE[0]}>
                  <title>{`${g.label}: ${formatTick(g.value)}`}</title>
                </rect>
              ))}
            {(chart.kind === "line" || chart.kind === "scatter") &&
              chart.series.map((s, si) => (
                <g key={s.column} data-series={s.name}>
                  {chart.kind === "line" && <path d={linePath(s.pts, chart.sx, chart.sy)} fill="none" stroke={PALETTE[si % PALETTE.length]} strokeWidth={2} strokeLinejoin="round" />}
                  {(chart.kind === "scatter" || s.pts.length <= 60) &&
                    s.pts.slice(0, 3000).map((p, i) => (
                      <circle key={i} cx={chart.sx(p.x)} cy={chart.sy(p.y)} r={chart.kind === "scatter" ? 3.2 : 2.6} fill={PALETTE[si % PALETTE.length]} fillOpacity={chart.kind === "scatter" ? 0.7 : 1}>
                        <title>{`${s.name}: ${formatTick(p.y)}`}</title>
                      </circle>
                    ))}
                </g>
              ))}
            {(chart.kind === "line" || chart.kind === "scatter") && chart.fit && <line data-trend x1={chart.sx(chart.x0)} x2={chart.sx(chart.x1)} y1={chart.sy(chart.fit.slope * chart.x0 + chart.fit.intercept)} y2={chart.sy(chart.fit.slope * chart.x1 + chart.fit.intercept)} stroke="currentColor" strokeDasharray="6 4" strokeOpacity={0.7} />}
            {(chart.kind === "line" || chart.kind === "scatter") && chart.series.length > 1 && (
              <g fontSize={11.5}>
                {chart.series.map((s, si) => (
                  <g key={s.column} transform={`translate(${M.left + 12 + si * 130} ${M.top + 4})`}>
                    <rect width={10} height={10} fill={PALETTE[si % PALETTE.length]} />
                    <text x={15} y={9} fill="currentColor">
                      {s.name.slice(0, 16)}
                    </text>
                  </g>
                ))}
              </g>
            )}
          </svg>
        ) : null}
      </div>
      <div className="flex min-h-[26px] flex-wrap items-center gap-x-4 border-t border-border/60 px-2 py-1 text-muted-foreground" data-chart-stats>
        <span>
          {table.rows.length.toLocaleString()} rows · {table.columns.length} columns
        </span>
        {chart && !("empty" in chart) && chart.summary && (
          <span>
            min {formatTick(chart.summary.min)} · max {formatTick(chart.summary.max)} · mean {formatTick(chart.summary.mean)} · median {formatTick(chart.summary.median)}
          </span>
        )}
        {chart && !("empty" in chart) && (chart.kind === "line" || chart.kind === "scatter") && chart.fit && <span>trend r² {chart.fit.r2.toFixed(3)}</span>}
      </div>
    </div>
  );
});

export const CHART_ACTIONS = [{ id: "chart.open", label: "Chart: Plot this CSV / JSON file", keywords: ["chart", "plot", "graph", "line", "bar", "scatter", "histogram", "visualize", "csv", "json", "data"], run: openChartForActive }];
