interface Unit {
  readonly label: string;
  readonly ms: number;
}

const UNITS: readonly Unit[] = [
  { label: "d", ms: 86_400_000 },
  { label: "h", ms: 3_600_000 },
  { label: "m", ms: 60_000 },
  { label: "s", ms: 1_000 },
  { label: "ms", ms: 1 },
];

export interface HumanizeDurationOptions {
  /** Maximum number of unit segments to show. Defaults to 2. */
  maxUnits?: number;
  /** Smallest unit to include. Defaults to "s". */
  smallest?: "d" | "h" | "m" | "s" | "ms";
}

/**
 * Turn a millisecond duration into a compact human string like "2h 3m".
 * Rounds toward zero at the smallest displayed unit and drops empty segments.
 */
export function humanizeDuration(ms: number, options: HumanizeDurationOptions = {}): string {
  const { maxUnits = 2, smallest = "s" } = options;
  if (!Number.isFinite(ms)) return "—";

  const sign = ms < 0 ? "-" : "";
  let remaining = Math.abs(Math.round(ms));

  const smallestIndex = UNITS.findIndex((u) => u.label === smallest);
  const segments: string[] = [];

  for (let i = 0; i <= smallestIndex && segments.length < maxUnits; i++) {
    const unit = UNITS[i];
    const count = Math.floor(remaining / unit.ms);
    if (count > 0 || (segments.length === 0 && i === smallestIndex)) {
      segments.push(`${count}${unit.label}`);
      remaining -= count * unit.ms;
    }
  }

  if (segments.length === 0) return `0${smallest}`;
  return sign + segments.join(" ");
}
