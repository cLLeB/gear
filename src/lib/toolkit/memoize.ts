/* eslint-disable @typescript-eslint/no-explicit-any */

export interface MemoizeOptions<T extends (...args: any[]) => any> {
  /** Derive a cache key from the arguments. Defaults to JSON.stringify. */
  resolver?: (...args: Parameters<T>) => string;
}

export interface Memoized<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): ReturnType<T>;
  /** Clear the entire cache. */
  clear(): void;
}

/**
 * Memoize a pure function, caching results by a key derived from its arguments.
 * The default resolver JSON-stringifies the argument list.
 */
export function memoize<T extends (...args: any[]) => any>(
  fn: T,
  options: MemoizeOptions<T> = {},
): Memoized<T> {
  const { resolver = (...args) => JSON.stringify(args) } = options;
  const cache = new Map<string, ReturnType<T>>();

  const memoized = ((...args: Parameters<T>): ReturnType<T> => {
    const key = resolver(...args);
    if (cache.has(key)) return cache.get(key)!;
    const result = fn(...args);
    cache.set(key, result);
    return result;
  }) as Memoized<T>;

  memoized.clear = () => cache.clear();
  return memoized;
}
