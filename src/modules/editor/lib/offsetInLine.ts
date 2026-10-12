/**
 * Document offset for a 1-based column on a line, as compilers and linters report it.
 * A missing, zero or oversized column stays on the line: it never spills onto the next one.
 */
export function offsetInLine(line: { from: number; to: number }, column?: number | null): number {
  if (!column || !Number.isFinite(column) || column < 1) return line.from;
  return Math.min(line.to, line.from + Math.floor(column) - 1);
}
