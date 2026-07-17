type Plain = Record<string, unknown>;

function isPlainObject(value: unknown): value is Plain {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof RegExp)
  );
}

/**
 * Recursively merge plain objects into a new object. Later sources win.
 * Arrays and non-plain values are replaced, not merged. Inputs are not mutated.
 */
export function deepMerge<T extends Plain = Plain>(...sources: Plain[]): T {
  const out: Plain = {};
  for (const source of sources) {
    if (!isPlainObject(source)) continue;
    for (const key of Object.keys(source)) {
      const next = source[key];
      const prev = out[key];
      if (isPlainObject(prev) && isPlainObject(next)) {
        out[key] = deepMerge(prev, next);
      } else {
        out[key] = next;
      }
    }
  }
  return out as T;
}
