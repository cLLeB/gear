export interface ParsedUrl {
  protocol: string;
  host: string;
  port: string;
  path: string;
  query: Record<string, string>;
  hash: string;
}

/** Parse a URL into structured parts, or null when invalid. */
export function parseUrl(value: string): ParsedUrl | null {
  try {
    const url = new URL(value);
    const query: Record<string, string> = {};
    url.searchParams.forEach((v, k) => {
      query[k] = v;
    });
    return {
      protocol: url.protocol.replace(/:$/, ""),
      host: url.hostname,
      port: url.port,
      path: url.pathname,
      query,
      hash: url.hash.replace(/^#/, ""),
    };
  } catch {
    return null;
  }
}

/**
 * Join a base URL or path with additional segments, collapsing duplicate
 * slashes but preserving the protocol's "//".
 */
export function joinUrl(base: string, ...segments: string[]): string {
  const parts = [base, ...segments].filter((s) => s.length > 0);
  return parts
    .join("/")
    .replace(/([^:]\/)\/+/g, "$1")
    .replace(/\/+$/, (m, _offset, str) => (str.length === 1 ? m : ""));
}
