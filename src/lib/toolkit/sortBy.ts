export type Selector<T> = (item: T) => number | string | boolean;

export interface SortKey<T> {
  by: Selector<T>;
  desc?: boolean;
}

function compare(a: number | string | boolean, b: number | string | boolean): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Return a new array sorted by one or more key selectors. Each key may be a
 * plain selector or `{ by, desc }`. The sort is stable across keys.
 */
export function sortBy<T>(items: readonly T[], ...keys: (Selector<T> | SortKey<T>)[]): T[] {
  const normalized: SortKey<T>[] = keys.map((k) => (typeof k === "function" ? { by: k } : k));

  return [...items].sort((a, b) => {
    for (const { by, desc } of normalized) {
      const result = compare(by(a), by(b));
      if (result !== 0) return desc ? -result : result;
    }
    return 0;
  });
}
