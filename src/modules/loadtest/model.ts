// HTTP load test: turning one timing per request into the numbers people ask
// for — throughput, percentiles, a latency histogram and a per-second timeline.

import type { BenchSample } from "@/modules/tools/paneHandle";

/** Percentile by linear interpolation; `sorted` must be ascending. */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

export interface Summary {
  requests: number;
  ok: number;
  failed: number;
  /** Requests per second over the whole run. */
  rps: number;
  mean: number;
  min: number;
  max: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  stdev: number;
  bytes: number;
  /** Status code (0 for "no response") to count, most common first. */
  statuses: [number, number][];
  errors: [string, number][];
}

/** A response counts as a failure when nothing came back or the server answered 5xx. */
export const isFailure = (s: BenchSample) => s.status === 0 || s.status >= 500;

export function summarize(samples: BenchSample[], elapsedMs: number): Summary {
  const times = samples.map((s) => s.ms).sort((a, b) => a - b);
  const n = times.length;
  const mean = n ? times.reduce((a, b) => a + b, 0) / n : 0;
  const variance = n ? times.reduce((a, t) => a + (t - mean) ** 2, 0) / n : 0;
  const statuses = new Map<number, number>();
  const errors = new Map<string, number>();
  let bytes = 0;
  let failed = 0;
  for (const s of samples) {
    statuses.set(s.status, (statuses.get(s.status) ?? 0) + 1);
    if (s.error) errors.set(s.error, (errors.get(s.error) ?? 0) + 1);
    bytes += s.bytes;
    if (isFailure(s)) failed++;
  }
  const byCount = <K>(m: Map<K, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  return {
    requests: n,
    ok: n - failed,
    failed,
    rps: elapsedMs > 0 ? n / (elapsedMs / 1000) : 0,
    mean,
    min: times[0] ?? 0,
    max: times[n - 1] ?? 0,
    p50: percentile(times, 50),
    p90: percentile(times, 90),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    stdev: Math.sqrt(variance),
    bytes,
    statuses: byCount(statuses),
    errors: byCount(errors),
  };
}

export interface Bucket {
  from: number;
  to: number;
  count: number;
}

/**
 * Latency histogram. The top end is cut at the 99th percentile so a single
 * slow request does not squash everything else into the first bar; the last
 * bucket collects whatever lies beyond.
 */
export function histogram(samples: BenchSample[], buckets = 24): Bucket[] {
  const times = samples.map((s) => s.ms).sort((a, b) => a - b);
  if (!times.length) return [];
  const lo = times[0];
  const hi = Math.max(percentile(times, 99), lo);
  if (hi === lo) return [{ from: lo, to: hi, count: times.length }];
  const width = (hi - lo) / buckets;
  const out: Bucket[] = Array.from({ length: buckets }, (_, i) => ({ from: lo + i * width, to: lo + (i + 1) * width, count: 0 }));
  for (const t of times) out[Math.min(buckets - 1, Math.floor((t - lo) / width))].count++;
  out[buckets - 1].to = times[times.length - 1];
  return out;
}

export interface Second {
  second: number;
  count: number;
  failed: number;
  mean: number;
}

/** Completed requests in each second of the run. */
export function timeline(samples: BenchSample[]): Second[] {
  const map = new Map<number, { count: number; failed: number; total: number }>();
  for (const s of samples) {
    const k = Math.floor(s.at_ms / 1000);
    const e = map.get(k) ?? { count: 0, failed: 0, total: 0 };
    e.count++;
    e.total += s.ms;
    if (isFailure(s)) e.failed++;
    map.set(k, e);
  }
  if (!map.size) return [];
  const last = Math.max(...map.keys());
  return Array.from({ length: last + 1 }, (_, second) => {
    const e = map.get(second);
    return { second, count: e?.count ?? 0, failed: e?.failed ?? 0, mean: e ? e.total / e.count : 0 };
  });
}

export function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 100) return `${ms.toFixed(0)} ms`;
  return `${ms.toFixed(ms >= 10 ? 1 : 2)} ms`;
}

/** Headers typed one per line as `Name: value`; blank lines and lines without a colon are skipped. */
export function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at <= 0) continue;
    const name = line.slice(0, at).trim();
    if (name) out[name] = line.slice(at + 1).trim();
  }
  return out;
}

export interface Settings {
  url: string;
  method: string;
  total: number;
  concurrency: number;
  timeoutMs: number;
}

/** Why a run cannot start, or null. The address rule itself is enforced by the backend. */
export function settingsProblem(s: Settings): string | null {
  if (!/^https?:\/\/\S+$/i.test(s.url.trim())) return "Enter an address starting with http:// or https://";
  if (!Number.isInteger(s.total) || s.total < 1 || s.total > 20000) return "Requests must be a whole number from 1 to 20,000.";
  if (!Number.isInteger(s.concurrency) || s.concurrency < 1 || s.concurrency > 64) return "Concurrency must be a whole number from 1 to 64.";
  if (s.concurrency > s.total) return "Concurrency cannot be higher than the number of requests.";
  if (!(s.timeoutMs >= 100 && s.timeoutMs <= 120000)) return "The timeout must be between 100 ms and 120,000 ms.";
  return null;
}

/** A plain-text report for pasting into an issue or a chat. */
export function report(s: Summary, settings: Settings, elapsedMs: number): string {
  const pct = (n: number) => (s.requests ? `${((n / s.requests) * 100).toFixed(1)}%` : "0%");
  return [
    `${settings.method} ${settings.url}`,
    `${s.requests} requests, ${settings.concurrency} at a time, in ${(elapsedMs / 1000).toFixed(2)} s`,
    `Throughput   ${s.rps.toFixed(1)} req/s`,
    `Failed       ${s.failed} (${pct(s.failed)})`,
    `Latency      mean ${formatMs(s.mean)}, min ${formatMs(s.min)}, max ${formatMs(s.max)}`,
    `Percentiles  p50 ${formatMs(s.p50)}, p90 ${formatMs(s.p90)}, p95 ${formatMs(s.p95)}, p99 ${formatMs(s.p99)}`,
    `Statuses     ${s.statuses.map(([code, n]) => `${code || "no response"}: ${n}`).join(", ")}`,
  ].join("\n");
}
