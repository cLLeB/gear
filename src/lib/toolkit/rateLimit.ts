/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyFn = (...args: any[]) => void;

export interface Debounced<T extends AnyFn> {
  (...args: Parameters<T>): void;
  cancel(): void;
  flush(): void;
}

/**
 * Return a debounced wrapper that delays invoking `fn` until `wait` ms have
 * elapsed since the last call. Supports leading-edge invocation and cancel/flush.
 */
export function debounce<T extends AnyFn>(fn: T, wait: number, leading = false): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  const debounced = ((...args: Parameters<T>) => {
    lastArgs = args;
    const callNow = leading && timer === null;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!leading && lastArgs) fn(...lastArgs);
    }, wait);
    if (callNow) fn(...args);
  }) as Debounced<T>;

  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };
  debounced.flush = () => {
    if (timer && lastArgs && !leading) fn(...lastArgs);
    debounced.cancel();
  };
  return debounced;
}

/** Return a throttled wrapper that invokes `fn` at most once per `wait` ms. */
export function throttle<T extends AnyFn>(fn: T, wait: number): T {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return ((...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn(...args);
      }, remaining);
    }
  }) as T;
}
