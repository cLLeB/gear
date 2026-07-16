export interface Limiter {
  <T>(task: () => Promise<T>): Promise<T>;
  /** Number of tasks currently running. */
  readonly active: number;
  /** Number of tasks waiting to start. */
  readonly pending: number;
}

/**
 * Create a concurrency limiter that runs at most `concurrency` tasks at once,
 * queueing the rest. Preserves each task's resolved/rejected value.
 */
export function pLimit(concurrency: number): Limiter {
  if (concurrency < 1) throw new RangeError("concurrency must be >= 1");
  const queue: (() => void)[] = [];
  let active = 0;

  const next = () => {
    if (active >= concurrency) return;
    const run = queue.shift();
    if (run) {
      active += 1;
      run();
    }
  };

  const limit = (<T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            next();
          });
      });
      next();
    })) as Limiter;

  Object.defineProperties(limit, {
    active: { get: () => active },
    pending: { get: () => queue.length },
  });
  return limit;
}
