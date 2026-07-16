export interface FormatPercentOptions {
  /** Fractional digits. Defaults to 0. */
  digits?: number;
  /** Prefix positive values with "+". Defaults to false. */
  signed?: boolean;
  /** Input is already a percentage (0-100) rather than a fraction (0-1). */
  fromPercent?: boolean;
}

/**
 * Format a fraction as a percentage string. By default 0.42 -> "42%".
 * Set `fromPercent` when the input is already scaled to 0-100.
 */
export function formatPercent(value: number, options: FormatPercentOptions = {}): string {
  const { digits = 0, signed = false, fromPercent = false } = options;
  if (!Number.isFinite(value)) return "—";
  const pct = fromPercent ? value : value * 100;
  const sign = signed && pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}
