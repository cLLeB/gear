/** Return a new object with only the given keys (that exist on the source). */
export function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) out[key] = obj[key];
  }
  return out;
}

/** Return a new object without the given keys. */
export function omit<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const drop = new Set<PropertyKey>(keys);
  const out = {} as Record<PropertyKey, unknown>;
  for (const key of Object.keys(obj)) {
    if (!drop.has(key)) out[key] = (obj as Record<string, unknown>)[key];
  }
  return out as Omit<T, K>;
}
