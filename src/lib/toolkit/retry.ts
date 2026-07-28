export interface RetryOptions {
  /** Maximum attempts including the first. Defaults to 3. */
  attempts?: number;
  /** Base delay in ms before the first retry. Defaults to 200. */
  baseDelay?: number;
  /** Multiplier applied to the delay each attempt. Defaults to 2. */
  factor?: number;
  /** Upper bound on any single delay in ms. Defaults to 10_000. */
  maxDelay?: number;
  /** Random jitter fraction (0-1) applied to each delay. Defaults to 0. */
  jitter?: number;
  /** Return false to stop retrying a given error. Defaults to always retry. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Sleep implementation (injectable for tests). */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run an async operation with exponential backoff. Rethrows the last error once
 * attempts are exhausted or `shouldRetry` returns false.
 */
export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    attempts = 3,
    baseDelay = 200,
    factor = 2,
    maxDelay = 10_000,
    jitter = 0,
    shouldRetry = () => true,
    sleep = defaultSleep,
  } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetry(error, attempt)) break;
      const raw = Math.min(baseDelay * factor ** (attempt - 1), maxDelay);
      const delay = jitter > 0 ? raw * (1 + (Math.random() * 2 - 1) * jitter) : raw;
      await sleep(Math.max(0, Math.round(delay)));
    }
  }
  throw lastError;
}
