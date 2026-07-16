/** Sum of a numeric array. */
export function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** Arithmetic mean, or NaN for an empty array. */
export function mean(values: readonly number[]): number {
  return values.length === 0 ? NaN : sum(values) / values.length;
}

/** Median value (average of the two middle elements for even counts). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Population variance. */
export function variance(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const m = mean(values);
  return sum(values.map((v) => (v - m) ** 2)) / values.length;
}

/** Population standard deviation. */
export function stddev(values: readonly number[]): number {
  return Math.sqrt(variance(values));
}

/**
 * Linear-interpolated percentile (p in [0, 100]) over the sorted values,
 * matching the common "linear" method used by NumPy's default.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}
