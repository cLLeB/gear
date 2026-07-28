/**
 * Generate a numeric range [start, end) with an optional step. Negative steps
 * are supported for descending ranges. A single argument is treated as the end
 * with start 0.
 */
export function range(start: number, end?: number, step = 1): number[] {
  if (end === undefined) {
    end = start;
    start = 0;
  }
  if (step === 0) throw new RangeError("step must be non-zero");
  const out: number[] = [];
  if (step > 0) {
    for (let i = start; i < end; i += step) out.push(i);
  } else {
    for (let i = start; i > end; i += step) out.push(i);
  }
  return out;
}

/** Zip two arrays into pairs, truncating to the shorter length. */
export function zip<A, B>(a: readonly A[], b: readonly B[]): [A, B][] {
  const len = Math.min(a.length, b.length);
  const out: [A, B][] = [];
  for (let i = 0; i < len; i++) out.push([a[i], b[i]]);
  return out;
}

/** Sliding windows of size `n` over an array. */
export function windows<T>(items: readonly T[], n: number): T[][] {
  if (n <= 0) throw new RangeError("n must be > 0");
  const out: T[][] = [];
  for (let i = 0; i + n <= items.length; i++) out.push(items.slice(i, i + n));
  return out;
}
