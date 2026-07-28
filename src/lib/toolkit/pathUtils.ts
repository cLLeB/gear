/**
 * Cross-platform, dependency-free path helpers that operate on forward-slash
 * POSIX-style paths. Backslashes are normalised to slashes on input so they
 * work uniformly for display and matching regardless of host OS.
 */

function normalize(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Final path segment, optionally with an extension stripped. */
export function basename(path: string, ext?: string): string {
  const p = normalize(path).replace(/\/+$/, "");
  const base = p.slice(p.lastIndexOf("/") + 1);
  if (ext && base.endsWith(ext) && base !== ext) return base.slice(0, -ext.length);
  return base;
}

/** Directory portion of a path, or "." when there is none. */
export function dirname(path: string): string {
  const p = normalize(path).replace(/\/+$/, "");
  const idx = p.lastIndexOf("/");
  if (idx === -1) return ".";
  if (idx === 0) return "/";
  return p.slice(0, idx);
}

/** File extension including the dot (".ts"), or "" when none. */
export function extname(path: string): string {
  const base = basename(path);
  const idx = base.lastIndexOf(".");
  if (idx <= 0) return "";
  return base.slice(idx);
}

/** Join segments with single slashes, collapsing redundant separators. */
export function joinPath(...segments: string[]): string {
  return segments
    .map((s) => normalize(s))
    .filter((s) => s.length > 0)
    .join("/")
    .replace(/\/{2,}/g, "/");
}
