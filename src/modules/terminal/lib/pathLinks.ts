// Clickable file locations in terminal output: `src/app.ts:12:5`,
// `./main.go:3`, `/abs/file.rs`, `File "x.py", line 12`, `foo.ts(12,5)`.
// Detection is pure and testable; the xterm link provider resolves relative
// paths against the pane's cwd and only links files that actually exist, so
// prose like "v1.2" or "e.g." never lights up.

import type { IBufferCellPosition, ILink, ILinkProvider, Terminal } from "@xterm/xterm";

export interface PathLinkMatch {
  /** 0-based start/end (exclusive) offsets in the line text. */
  start: number;
  end: number;
  path: string;
  line: number | null;
  column: number | null;
}

// A path token: optional drive or ./ ../ ~/ prefix, at least one separator or
// an extension, no whitespace/quotes/brackets. The trailing char must not be
// punctuation that usually ends a sentence.
const PATH_BODY = String.raw`(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|[\\/])?(?:[\w.@+-]+[\\/])*[\w@+-][\w.@+-]*`;
const LOCATION = String.raw`(?::(\d+)(?::(\d+))?|\((\d+)(?:,\s*(\d+))?\))?`;
const TOKEN_RE = new RegExp(String.raw`(?<![\w./\\~:-])(${PATH_BODY})${LOCATION}`, "g");
const PY_RE = /File "([^"]+)", line (\d+)/g;

function looksLikePath(p: string): boolean {
  if (p.length < 3 || /^\d+(\.\d+)*$/.test(p)) return false; // version numbers
  if (/^[a-z][\w+.-]*:\/\//i.test(p)) return false; // URLs handled elsewhere
  const hasSep = /[\\/]/.test(p);
  const ext = /\.([A-Za-z][A-Za-z0-9]{0,9})$/.exec(p);
  if (!hasSep && !ext) return false;
  // Bare "word.word" without a separator is too often prose or a domain.
  if (!hasSep && ext && /^(com|org|net|io|dev|app|co|uk|de|fr|jp)$/i.test(ext[1])) return false;
  return true;
}

export function findPathLinks(text: string): PathLinkMatch[] {
  const out: PathLinkMatch[] = [];
  const taken: Array<[number, number]> = [];
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a);

  for (const m of text.matchAll(PY_RE)) {
    const start = m.index! + 6; // after `File "`
    out.push({ start, end: start + m[1].length, path: m[1], line: +m[2], column: null });
    taken.push([m.index!, m.index! + m[0].length]);
  }
  for (const m of text.matchAll(TOKEN_RE)) {
    let path = m[1];
    // Trim sentence punctuation that the greedy body swallowed.
    while (/[.,;:]$/.test(path)) path = path.slice(0, -1);
    if (!looksLikePath(path)) continue;
    const start = m.index!;
    const hasLoc = m[1].length === path.length;
    const line = hasLoc ? (m[2] ?? m[4]) : undefined;
    const col = hasLoc ? (m[3] ?? m[5]) : undefined;
    const end = start + (hasLoc ? m[0].length : path.length);
    if (overlaps(start, end)) continue;
    out.push({
      start,
      end,
      path,
      line: line ? +line : null,
      column: col ? +col : null,
    });
    taken.push([start, end]);
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Join a possibly-relative path onto the pane's cwd; expands `~/` with home. */
export function resolveLinkPath(path: string, cwd: string | null, home: string | null): string | null {
  if (/^~[\\/]/.test(path)) return home ? `${home.replace(/[\\/]+$/, "")}/${path.slice(2)}` : null;
  if (/^([A-Za-z]:[\\/]|[\\/])/.test(path)) return path;
  if (!cwd) return null;
  return `${cwd.replace(/[\\/]+$/, "")}/${path.replace(/^\.[\\/]/, "")}`;
}

export interface PathLinkHost {
  cwd: () => string | null;
  home: () => string | null;
  exists: (path: string) => Promise<boolean>;
  open: (path: string, line: number | null) => void;
}

const existsCache = new Map<string, { ok: boolean; at: number }>();
const CACHE_MS = 10_000;

async function cachedExists(host: PathLinkHost, path: string): Promise<boolean> {
  const hit = existsCache.get(path);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_MS) return hit.ok;
  const ok = await host.exists(path).catch(() => false);
  existsCache.set(path, { ok, at: now });
  if (existsCache.size > 500) existsCache.delete(existsCache.keys().next().value!);
  return ok;
}

/** xterm link provider for file locations on the hovered line. */
export function createPathLinkProvider(term: Terminal, host: PathLinkHost): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const line = term.buffer.active.getLine(y - 1);
      if (!line) return callback(undefined);
      const text = line.translateToString(true);
      const matches = findPathLinks(text);
      if (matches.length === 0) return callback(undefined);
      const cwd = host.cwd();
      const home = host.home();
      void Promise.all(
        matches.map(async (m) => {
          const abs = resolveLinkPath(m.path, cwd, home);
          if (!abs || !(await cachedExists(host, abs))) return null;
          const range: { start: IBufferCellPosition; end: IBufferCellPosition } = {
            start: { x: m.start + 1, y },
            end: { x: m.end, y },
          };
          const link: ILink = {
            range,
            text: text.slice(m.start, m.end),
            decorations: { underline: true, pointerCursor: true },
            activate: () => host.open(abs, m.line),
          };
          return link;
        }),
      ).then((links) => {
        const ok = links.filter((l): l is ILink => l !== null);
        callback(ok.length > 0 ? ok : undefined);
      });
    },
  };
}
