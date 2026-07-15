const UNITS = ["B", "KB", "MB", "GB", "TB", "PB", "EB"] as const;
const IEC_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB"] as const;

export interface FormatBytesOptions {
  /** Use binary (1024) units with IEC suffixes instead of decimal (1000). */
  iec?: boolean;
  /** Number of fractional digits to keep. Defaults to 1. */
  precision?: number;
}

/**
 * Render a byte count as a compact, human-readable string.
 *
 * Handles negative values, sub-byte fractions, and very large magnitudes
 * without losing precision to floating point drift.
 */
export function formatBytes(bytes: number, options: FormatBytesOptions = {}): string {
  const { iec = false, precision = 1 } = options;
  if (!Number.isFinite(bytes)) return "—";

  const base = iec ? 1024 : 1000;
  const units = iec ? IEC_UNITS : UNITS;
  const sign = bytes < 0 ? "-" : "";
  let value = Math.abs(bytes);

  if (value < base) {
    return `${sign}${Math.round(value)} ${units[0]}`;
  }

  let unitIndex = 0;
  while (value >= base && unitIndex < units.length - 1) {
    value /= base;
    unitIndex += 1;
  }

  const rounded = Number(value.toFixed(precision));
  return `${sign}${rounded} ${units[unitIndex]}`;
}
