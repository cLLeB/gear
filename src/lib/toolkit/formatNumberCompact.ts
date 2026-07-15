const SUFFIXES = ["", "k", "M", "B", "T", "Q"] as const;

export interface CompactNumberOptions {
  /** Significant fractional digits. Defaults to 1. */
  precision?: number;
}

/**
 * Format a number in compact notation: 1200 -> "1.2k", 3_400_000 -> "3.4M".
 * Uses base-1000 groupings and drops trailing zeros.
 */
export function formatNumberCompact(value: number, options: CompactNumberOptions = {}): string {
  const { precision = 1 } = options;
  if (!Number.isFinite(value)) return "—";

  const sign = value < 0 ? "-" : "";
  let n = Math.abs(value);
  if (n < 1000) return `${sign}${n}`;

  let i = 0;
  while (n >= 1000 && i < SUFFIXES.length - 1) {
    n /= 1000;
    i += 1;
  }
  const rounded = Number(n.toFixed(precision));
  return `${sign}${rounded}${SUFFIXES[i]}`;
}
