interface Threshold {
  readonly limit: number;
  readonly unit: Intl.RelativeTimeFormatUnit;
  readonly ms: number;
}

const THRESHOLDS: readonly Threshold[] = [
  { limit: 60_000, unit: "second", ms: 1_000 },
  { limit: 3_600_000, unit: "minute", ms: 60_000 },
  { limit: 86_400_000, unit: "hour", ms: 3_600_000 },
  { limit: 604_800_000, unit: "day", ms: 86_400_000 },
  { limit: 2_629_800_000, unit: "week", ms: 604_800_000 },
  { limit: 31_557_600_000, unit: "month", ms: 2_629_800_000 },
  { limit: Infinity, unit: "year", ms: 31_557_600_000 },
];

/**
 * Format the gap between `from` and `to` (default now) as a relative phrase
 * like "3 minutes ago" or "in 2 days", using Intl for locale correctness.
 */
export function relativeTime(from: number | Date, to: number | Date = Date.now(), locale?: string): string {
  const fromMs = from instanceof Date ? from.getTime() : from;
  const toMs = to instanceof Date ? to.getTime() : to;
  const diff = fromMs - toMs;
  const abs = Math.abs(diff);

  const threshold = THRESHOLDS.find((t) => abs < t.limit) ?? THRESHOLDS[THRESHOLDS.length - 1];
  const value = Math.round(diff / threshold.ms);

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  return rtf.format(value, threshold.unit);
}
