/* eslint-disable @typescript-eslint/no-explicit-any */

export interface OnceFn<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): ReturnType<T>;
  /** True once the wrapped function has been invoked. */
  readonly called: boolean;
  /** Reset so the function can run again. */
  reset(): void;
}

/**
 * Wrap a function so it runs at most once; subsequent calls return the cached
 * first result. Useful for idempotent initialisation.
 */
export function once<T extends (...args: any[]) => any>(fn: T): OnceFn<T> {
  let called = false;
  let result: ReturnType<T>;

  const wrapped = ((...args: Parameters<T>): ReturnType<T> => {
    if (!called) {
      result = fn(...args);
      called = true;
    }
    return result;
  }) as OnceFn<T>;

  Object.defineProperty(wrapped, "called", { get: () => called });
  wrapped.reset = () => {
    called = false;
  };
  return wrapped;
}
