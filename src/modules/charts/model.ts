// Charts from a CSV / TSV / JSON file: reading the data into columns, working
// out what kind each column is, and the geometry of line, bar, scatter and
// histogram charts.

import { numeric, parseCsv } from "@/modules/table/model";

export interface Table {
  columns: string[];
  rows: string[][];
}

/** A JSON array of objects (or of arrays), or an object of arrays, as a table. */
export function tableFromJson(text: string): Table | string {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return `Not valid JSON: ${(err as Error).message}`;
  }
  const cell = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  // { "data": [...] } and similar wrappers: use the first array found one level down.
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const arrays = Object.entries(obj).filter(([, v]) => Array.isArray(v));
    if (arrays.length > 1 && arrays.every(([, v]) => (v as unknown[]).every((x) => typeof x !== "object" || x === null))) {
      const columns = arrays.map(([k]) => k);
      const length = Math.max(...arrays.map(([, v]) => (v as unknown[]).length));
      return { columns, rows: Array.from({ length }, (_, i) => arrays.map(([, v]) => cell((v as unknown[])[i]))) };
    }
    if (arrays.length >= 1) data = arrays[0][1];
  }
  if (!Array.isArray(data)) return "Expected a list of records: an array of objects, or an object whose values are arrays.";
  if (!data.length) return "The list is empty.";
  if (data.every((r) => Array.isArray(r))) {
    const [head, ...rest] = data as unknown[][];
    return { columns: head.map(cell), rows: rest.map((r) => r.map(cell)) };
  }
  if (!data.every((r) => r && typeof r === "object")) return { columns: ["value"], rows: data.map((v) => [cell(v)]) };
  const columns: string[] = [];
  for (const r of data as Record<string, unknown>[]) for (const k of Object.keys(r)) if (!columns.includes(k)) columns.push(k);
  return { columns, rows: (data as Record<string, unknown>[]).map((r) => columns.map((c) => cell(r[c]))) };
}

export function loadTable(text: string, fileName: string): Table | string {
  if (/\.(json|geojson)$/i.test(fileName) || /^\s*[[{]/.test(text)) return tableFromJson(text);
  const t = parseCsv(text, undefined, fileName);
  if (t.rows.length < 2) return "This file needs a header row and at least one row of data.";
  const [head, ...rows] = t.rows;
  return { columns: head.map((h, i) => h.trim() || `column ${i + 1}`), rows: rows.filter((r) => r.some((c) => c.trim() !== "")) };
}

export type Kind = "number" | "date" | "text";

/** Milliseconds for an ISO-like date (or a 4-digit year), else null. */
export function dateValue(cell: string): number | null {
  const s = cell.trim();
  if (!/^\d{4}(-\d{1,2}(-\d{1,2})?)?([T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s) && !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return null;
  if (/^\d{4}$/.test(s)) return Date.UTC(Number(s), 0, 1);
  const t = Date.parse(/^\d{4}-\d{1,2}(-\d{1,2})?$/.test(s) ? `${s.split("-").map((p, i) => (i ? p.padStart(2, "0") : p)).join("-")}${s.split("-").length === 2 ? "-01" : ""}T00:00:00Z` : s);
  return Number.isNaN(t) ? null : t;
}

/** What most of a column's filled cells are. */
export function columnKind(rows: string[][], column: number): Kind {
  let n = 0;
  let nums = 0;
  let dates = 0;
  for (const r of rows.slice(0, 2000)) {
    const v = (r[column] ?? "").trim();
    if (!v) continue;
    n++;
    if (numeric(v) !== null) nums++;
    if (dateValue(v) !== null) dates++;
  }
  if (!n) return "text";
  // A column of plain years reads as numbers and as dates; dates make the better axis.
  if (dates / n >= 0.9 && (nums / n < 0.9 || rows.slice(0, 50).every((r) => /^\s*(1[5-9]|2[0-2])\d\d\s*$/.test(r[column] ?? "") || !(r[column] ?? "").trim()))) return "date";
  return nums / n >= 0.9 ? "number" : "text";
}

/** Round tick values covering [min, max]: about `count` of them, at 1, 2 or 5 times a power of ten. */
export function niceTicks(min: number, max: number, count = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v < max + step * 0.999; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

export function formatTick(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${Number((v / 1e9).toPrecision(3))}B`;
  if (a >= 1e6) return `${Number((v / 1e6).toPrecision(3))}M`;
  if (a >= 1e4) return `${Number((v / 1e3).toPrecision(3))}k`;
  return String(Number(v.toPrecision(6)));
}

export function formatDate(ms: number, spanMs: number): string {
  const d = new Date(ms);
  const iso = d.toISOString();
  if (spanMs > 3 * 365 * 86400000) return iso.slice(0, 4);
  if (spanMs > 60 * 86400000) return iso.slice(0, 7);
  if (spanMs > 2 * 86400000) return iso.slice(5, 10);
  return iso.slice(11, 16);
}

export type Aggregate = "sum" | "mean" | "count" | "min" | "max";

/** Groups rows by a category column and reduces one value column per group; first-seen order. */
export function aggregate(rows: string[][], by: number, value: number, how: Aggregate): { label: string; value: number }[] {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const key = (r[by] ?? "").trim() || "(blank)";
    const n = numeric(r[value] ?? "");
    const list = groups.get(key) ?? [];
    if (how === "count") list.push(1);
    else if (n !== null) list.push(n);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([label, xs]) => ({
    label,
    value: !xs.length ? 0 : how === "sum" || how === "count" ? xs.reduce((a, b) => a + b, 0) : how === "mean" ? xs.reduce((a, b) => a + b, 0) / xs.length : how === "min" ? Math.min(...xs) : Math.max(...xs),
  }));
}

export interface Point {
  x: number;
  y: number;
}

/** (x, y) pairs for one series; rows where either value is missing are skipped. Sorted by x for lines. */
export function points(rows: string[][], xCol: number, yCol: number, xKind: Kind, sort = true): Point[] {
  const out: Point[] = [];
  rows.forEach((r, i) => {
    const y = numeric(r[yCol] ?? "");
    const x = xKind === "date" ? dateValue(r[xCol] ?? "") : xKind === "number" ? numeric(r[xCol] ?? "") : i;
    if (x !== null && y !== null) out.push({ x, y });
  });
  return sort ? out.sort((a, b) => a.x - b.x) : out;
}

export interface Bin {
  from: number;
  to: number;
  count: number;
}

/** Equal-width bins; the number of bins follows Sturges' rule unless given. */
export function bins(values: number[], count?: number): Bin[] {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ from: min, to: max, count: values.length }];
  const n = count ?? Math.min(40, Math.max(5, Math.ceil(Math.log2(values.length) + 1)));
  const width = (max - min) / n;
  const out: Bin[] = Array.from({ length: n }, (_, i) => ({ from: min + i * width, to: min + (i + 1) * width, count: 0 }));
  for (const v of values) out[Math.min(n - 1, Math.floor((v - min) / width))].count++;
  return out;
}

/** Maps a value in [d0, d1] onto [r0, r1]. */
export function scale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

export function linePath(pts: Point[], sx: (v: number) => number, sy: (v: number) => number): string {
  return pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join("");
}

export interface Stats {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
}

export function stats(values: number[]): Stats | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return { count: s.length, min: s[0], max: s[s.length - 1], mean: s.reduce((a, b) => a + b, 0) / s.length, median: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2 };
}

/** Least-squares line through the points, with r². Null when x does not vary. */
export function trend(pts: Point[]): { slope: number; intercept: number; r2: number } | null {
  const n = pts.length;
  if (n < 2) return null;
  const mx = pts.reduce((a, p) => a + p.x, 0) / n;
  const my = pts.reduce((a, p) => a + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy) };
}

export type ChartType = "line" | "bar" | "scatter" | "histogram";

/** A sensible first chart for a table: which type and which columns. */
export function suggest(t: Table): { type: ChartType; x: number; ys: number[] } {
  const kinds = t.columns.map((_, i) => columnKind(t.rows, i));
  const nums = kinds.map((k, i) => (k === "number" ? i : -1)).filter((i) => i >= 0);
  const date = kinds.indexOf("date");
  const text = kinds.indexOf("text");
  if (date >= 0 && nums.length) return { type: "line", x: date, ys: nums.filter((i) => i !== date).slice(0, 3) };
  if (text >= 0 && nums.length) return { type: "bar", x: text, ys: [nums[0]] };
  if (nums.length >= 2) return { type: "scatter", x: nums[0], ys: [nums[1]] };
  if (nums.length === 1) return { type: "histogram", x: nums[0], ys: [nums[0]] };
  return { type: "bar", x: 0, ys: [] };
}

export const PALETTE = ["#4f8ef7", "#f2994a", "#27ae60", "#eb5757", "#9b51e0", "#00b8d9", "#f2c94c", "#6d7b8d"];
