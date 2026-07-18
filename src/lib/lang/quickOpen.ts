// File "quick open" ranking (Ctrl-P). Given a query and a list of paths it
// returns the paths ordered the way a developer expects: fuzzy subsequence
// matches, but with a strong bonus when the match lands in the file's basename
// (people search for `button`, not `src/components/`), and boosted by
// "frecency" — a blend of how often and how recently a file was opened, so the
// files you actually work in float to the top. The frecency store is separate
// so it can be persisted and shared with other rankers.

import { fuzzyMatch } from "./fuzzy";

export interface RankedPath {
  path: string;
  score: number;
  /** Matched character positions within the full path, for highlighting. */
  positions: number[];
}

/** Extra score added when the query matches inside the basename. */
const BASENAME_BONUS = 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Tracks how often and how recently each path was opened. */
export class Frecency {
  private data = new Map<string, { count: number; last: number }>();

  /** Record an access to `path`. */
  visit(path: string, now: number = Date.now()): void {
    const entry = this.data.get(path) ?? { count: 0, last: 0 };
    this.data.set(path, { count: entry.count + 1, last: now });
  }

  /** Frecency score: visit count weighted by how recent the last visit was. */
  score(path: string, now: number = Date.now()): number {
    const entry = this.data.get(path);
    if (!entry) return 0;
    const age = now - entry.last;
    const recency = age < DAY_MS ? 4 : age < 7 * DAY_MS ? 2 : age < 30 * DAY_MS ? 1 : 0.5;
    return entry.count * recency;
  }
}

function basename(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash === -1 ? path : path.slice(slash + 1);
}

/** Fuzzy-match a query against a path, preferring basename hits. */
function matchPath(query: string, path: string): { score: number; positions: number[] } | null {
  const base = basename(path);
  const offset = path.length - base.length;

  const inBase = fuzzyMatch(query, base);
  if (inBase) return { score: inBase.score + BASENAME_BONUS, positions: inBase.positions.map((p) => p + offset) };

  const inFull = fuzzyMatch(query, path);
  if (inFull) return { score: inFull.score, positions: inFull.positions };
  return null;
}

/**
 * Rank `paths` for a query. An empty query orders purely by frecency (then
 * shortest path). Ties in match score are broken by frecency, then length.
 */
export function quickOpen(
  query: string,
  paths: readonly string[],
  frecency?: Frecency,
  now: number = Date.now(),
): RankedPath[] {
  const q = query.trim();
  const scoreOf = (path: string) => (frecency ? frecency.score(path, now) : 0);

  if (q === "") {
    return [...paths]
      .map((path) => ({ path, score: scoreOf(path), positions: [] as number[] }))
      .sort((a, b) => b.score - a.score || a.path.length - b.path.length || (a.path < b.path ? -1 : 1));
  }

  const ranked: Array<RankedPath & { len: number }> = [];
  for (const path of paths) {
    const m = matchPath(q, path);
    if (!m) continue;
    ranked.push({ path, score: m.score + scoreOf(path), positions: m.positions, len: path.length });
  }
  ranked.sort((a, b) => b.score - a.score || a.len - b.len || (a.path < b.path ? -1 : 1));
  return ranked.map(({ path, score, positions }) => ({ path, score, positions }));
}
