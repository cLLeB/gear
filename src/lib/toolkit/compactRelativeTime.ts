interface Unit {
  readonly ms: number;
  readonly suffix: string;
}

const UNITS: readonly Unit[] = [
  { ms: 31_557_600_000, suffix: "y" },
  { ms: 2_629_800_000, suffix: "mo" },
  { ms: 604_800_000, suffix: "w" },
  { ms: 86_400_000, suffix: "d" },
  { ms: 3_600_000, suffix: "h" },
  { ms: 60_000, suffix: "m" },
  { ms: 1_000, suffix: "s" },
];

/**
 * Compact relative time such as "3m ago" or "in 2h". Under 5 seconds reads as
 * "now". Ideal for dense status bars and commit lists.
 */
export function compactRelativeTime(from: number | Date, to: number | Date = Date.now()): string {
  const fromMs = from instanceof Date ? from.getTime() : from;
  const toMs = to instanceof Date ? to.getTime() : to;
  const diff = fromMs - toMs;
  const abs = Math.abs(diff);

  if (abs < 5_000) return "now";
  const unit = UNITS.find((u) => abs >= u.ms) ?? UNITS[UNITS.length - 1];
  const value = Math.floor(abs / unit.ms);
  const label = `${value}${unit.suffix}`;
  return diff < 0 ? `${label} ago` : `in ${label}`;
}
