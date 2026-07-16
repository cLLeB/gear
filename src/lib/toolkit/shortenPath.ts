import { truncateMiddle } from "./truncateMiddle";

export interface ShortenPathOptions {
  /** Home directory to collapse to "~". Backslashes are normalised. */
  home?: string;
  /** Maximum display length; longer paths get a middle ellipsis. */
  maxLength?: number;
}

/**
 * Produce a compact, display-friendly path: collapse the home directory to "~"
 * and optionally truncate the middle to fit a maximum length.
 */
export function shortenPath(path: string, options: ShortenPathOptions = {}): string {
  const { home, maxLength } = options;
  let out = path.replace(/\\/g, "/");

  if (home) {
    const h = home.replace(/\\/g, "/").replace(/\/+$/, "");
    if (out === h) out = "~";
    else if (out.startsWith(`${h}/`)) out = `~${out.slice(h.length)}`;
  }

  if (maxLength && out.length > maxLength) {
    out = truncateMiddle(out, maxLength);
  }
  return out;
}
