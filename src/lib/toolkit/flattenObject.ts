/**
 * Flatten a nested object into a single-level map with dot-delimited keys.
 * Arrays are indexed numerically. Useful for config diffing and env export.
 */
export function flattenObject(
  obj: Record<string, unknown>,
  separator = ".",
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  const walk = (value: unknown, prefix: string): void => {
    if (value !== null && typeof value === "object" && !(value instanceof Date)) {
      const entries = Array.isArray(value)
        ? value.map((v, i) => [String(i), v] as const)
        : Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) {
        out[prefix] = Array.isArray(value) ? [] : {};
        return;
      }
      for (const [key, child] of entries) {
        walk(child, prefix ? `${prefix}${separator}${key}` : key);
      }
    } else {
      out[prefix] = value;
    }
  };

  walk(obj, "");
  return out;
}

/** Rebuild a nested object from a dot-delimited flat map. */
export function unflattenObject(
  flat: Record<string, unknown>,
  separator = ".",
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(flat)) {
    const keys = path.split(separator);
    let cursor = out;
    keys.forEach((key, i) => {
      if (i === keys.length - 1) {
        cursor[key] = value;
      } else {
        if (typeof cursor[key] !== "object" || cursor[key] === null) cursor[key] = {};
        cursor = cursor[key] as Record<string, unknown>;
      }
    });
  }
  return out;
}
