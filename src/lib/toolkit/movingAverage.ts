/**
 * Simple moving average over a sliding window. The output has the same length
 * as the input; early positions average whatever values are available so far.
 */
export function movingAverage(values: readonly number[], window: number): number[] {
  if (window <= 0) throw new RangeError("window must be > 0");
  const out: number[] = [];
  let running = 0;

  for (let i = 0; i < values.length; i++) {
    running += values[i];
    if (i >= window) running -= values[i - window];
    const count = Math.min(i + 1, window);
    out.push(running / count);
  }
  return out;
}

/**
 * Exponential moving average with smoothing factor alpha in (0, 1]; higher
 * alpha weights recent values more heavily.
 */
export function exponentialMovingAverage(values: readonly number[], alpha: number): number[] {
  if (alpha <= 0 || alpha > 1) throw new RangeError("alpha must be in (0, 1]");
  const out: number[] = [];
  let prev = 0;
  values.forEach((v, i) => {
    prev = i === 0 ? v : alpha * v + (1 - alpha) * prev;
    out.push(prev);
  });
  return out;
}
