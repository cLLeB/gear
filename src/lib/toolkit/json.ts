/** Parse JSON, returning a fallback (default null) instead of throwing. */
export function safeJsonParse<T = unknown>(input: string, fallback: T | null = null): T | null {
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

/**
 * Deterministically stringify a value with object keys sorted recursively, so
 * that equal objects always produce byte-identical output (useful for hashing,
 * caching, and diffing).
 */
export function stableStringify(value: unknown, space?: number): string {
  const seen = new WeakSet<object>();

  const normalize = (val: unknown): unknown => {
    if (val === null || typeof val !== "object") return val;
    if (seen.has(val as object)) throw new TypeError("circular reference");
    seen.add(val as object);

    if (Array.isArray(val)) {
      const arr = val.map(normalize);
      seen.delete(val as object);
      return arr;
    }
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(val as Record<string, unknown>).sort()) {
      sorted[key] = normalize((val as Record<string, unknown>)[key]);
    }
    seen.delete(val as object);
    return sorted;
  };

  return JSON.stringify(normalize(value), null, space);
}
