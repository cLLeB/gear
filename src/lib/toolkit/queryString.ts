export type QueryValue = string | number | boolean | null | undefined;

/**
 * Serialise a flat record into a URL query string. Arrays repeat the key;
 * null/undefined values are skipped. No leading "?".
 */
export function toQueryString(params: Record<string, QueryValue | QueryValue[]>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (v === null || v === undefined) continue;
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.join("&");
}

/**
 * Parse a query string into a record. Repeated keys collapse into arrays.
 * A leading "?" is tolerated.
 */
export function parseQueryString(query: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const clean = query.replace(/^\?/, "");
  if (!clean) return out;

  for (const pair of clean.split("&")) {
    if (!pair) continue;
    const idx = pair.indexOf("=");
    const key = decodeURIComponent(idx === -1 ? pair : pair.slice(0, idx));
    const value = idx === -1 ? "" : decodeURIComponent(pair.slice(idx + 1));
    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else out[key] = [existing, value];
  }
  return out;
}
