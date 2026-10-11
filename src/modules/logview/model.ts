// Log viewer helpers: rendering structured (JSON) log lines, and histogram
// geometry. Indexing / filtering / search live in Rust (logview.rs).

export type Level = "error" | "warn" | "info" | "debug" | "other";
export const LEVELS: Level[] = ["error", "warn", "info", "debug", "other"];

export interface Row {
  line: number;
  level: Level;
  time: number | null;
  text: string;
}

export interface LogInfo {
  id: number;
  lines: number;
  size: number;
  visible: number;
  rotated: boolean;
}

export interface Histogram {
  start: number;
  bucketMs: number;
  counts: [number, number, number, number, number][];
  unparsed: number;
}

const MSG_KEYS = ["msg", "message", "event", "text", "log"];
const DROP_KEYS = new Set(["level", "lvl", "severity", "time", "timestamp", "ts", "@timestamp", "datetime", ...MSG_KEYS]);

export interface Structured {
  message: string;
  fields: [string, string][];
}

/** A JSON log line → its message plus the remaining fields (nested values as JSON). */
export function structured(text: string): Structured | null {
  if (!text.startsWith("{")) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const msgKey = MSG_KEYS.find((k) => typeof o[k] === "string");
  const fields = Object.entries(o)
    .filter(([k]) => !DROP_KEYS.has(k))
    .map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)] as [string, string]);
  return { message: msgKey ? String(o[msgKey]) : "", fields };
}

export function formatTime(ms: number, withDate: boolean): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const t = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  return withDate ? `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${t}` : t;
}

export function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : n < 1 << 20 ? `${(n / 1024).toFixed(1)} KB` : n < 1 << 30 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${(n / (1 << 30)).toFixed(2)} GB`;
}

/** A readable bucket width ("1 s", "5 min", "2 h", "1 d"). */
export function formatSpan(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h`;
  return `${Math.round(ms / 86_400_000)} d`;
}

/** Bucket index under x (0…width) for n buckets. */
export function bucketAt(x: number, width: number, n: number): number {
  return Math.max(0, Math.min(n - 1, Math.floor((x / Math.max(1, width)) * n)));
}

/** Time range covered by buckets a…b (inclusive, any order). */
export function bucketRange(h: Histogram, a: number, b: number): { from: number; to: number } {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return { from: h.start + lo * h.bucketMs, to: h.start + (hi + 1) * h.bucketMs - 1 };
}

export function totals(h: Histogram | null): Record<Level, number> {
  const t: Record<Level, number> = { error: 0, warn: 0, info: 0, debug: 0, other: 0 };
  for (const c of h?.counts ?? []) LEVELS.forEach((l, i) => (t[l] += c[i]));
  return t;
}

export const isLogFile = (p: string) => /\.(log|log\.\d+|out|err)$/i.test(p) || /(^|\/)(syslog|messages)(\.\d+)?$/.test(p);
export const LOG_SCHEME = "gear-log://";
