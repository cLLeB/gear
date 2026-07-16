export type Comparator<T> = (a: T, b: T) => number;

const defaultCompare = <T>(a: T, b: T): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Binary-search a sorted array for `target`, returning its index or -1.
 * A custom comparator supports non-primitive element types.
 */
export function binarySearch<T>(sorted: readonly T[], target: T, compare: Comparator<T> = defaultCompare): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const c = compare(sorted[mid], target);
    if (c === 0) return mid;
    if (c < 0) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/**
 * Return the leftmost index at which `target` could be inserted to keep the
 * array sorted (a lower-bound / bisect-left).
 */
export function insertionIndex<T>(sorted: readonly T[], target: T, compare: Comparator<T> = defaultCompare): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (compare(sorted[mid], target) < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
