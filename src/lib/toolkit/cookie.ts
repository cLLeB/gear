/** Parse a Cookie header string into a key/value record. */
export function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    if (!key) continue;
    const value = pair.slice(idx + 1).trim();
    out[key] = decodeURIComponent(value);
  }
  return out;
}

export interface CookieOptions {
  path?: string;
  domain?: string;
  maxAge?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

/** Serialize a single Set-Cookie value with attributes. */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push("Secure");
  if (options.httpOnly) parts.push("HttpOnly");
  return parts.join("; ");
}
