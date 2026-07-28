import { pLimit } from "./pLimit";

/**
 * Async map with bounded concurrency: apply `fn` to each item, running at most
 * `concurrency` at a time, and resolve to results in the original order.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = pLimit(concurrency);
  return Promise.all(items.map((item, i) => limit(() => fn(item, i))));
}
