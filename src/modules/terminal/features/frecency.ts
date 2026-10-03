// Directory frecency in the style of zoxide/z: every visit bumps a rank, the
// score weights rank by how recently it was visited, and the database ages
// so it does not grow without bound.

export interface DirEntry {
  path: string;
  rank: number;
  /** Epoch ms of the last visit. */
  last: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
export const MAX_TOTAL_RANK = 10_000;

export function frecencyScore(e: DirEntry, now: number): number {
  const age = now - e.last;
  const factor = age < HOUR ? 4 : age < DAY ? 2 : age < WEEK ? 0.5 : 0.25;
  return e.rank * factor;
}

/** Record a visit; returns a new array (input untouched). */
export function recordVisit(db: readonly DirEntry[], path: string, now: number): DirEntry[] {
  const norm = path.replace(/[\\/]+$/, "") || path;
  let found = false;
  let next = db.map((e) => {
    if (e.path !== norm) return e;
    found = true;
    return { ...e, rank: e.rank + 1, last: now };
  });
  if (!found) next.push({ path: norm, rank: 1, last: now });
  const total = next.reduce((n, e) => n + e.rank, 0);
  if (total > MAX_TOTAL_RANK) {
    // Age everything; forget directories that decay below one visit.
    next = next.map((e) => ({ ...e, rank: e.rank * 0.9 })).filter((e) => e.rank >= 1);
  }
  return next;
}

/** Directories ranked best-first, optionally filtered by zoxide-style keywords. */
export function rankDirs(db: readonly DirEntry[], now: number, keywords: readonly string[] = []): DirEntry[] {
  const kws = keywords.map((k) => k.toLowerCase()).filter(Boolean);
  return db
    .filter((e) => matchesKeywords(e.path, kws))
    .sort((a, b) => frecencyScore(b, now) - frecencyScore(a, now) || a.path.localeCompare(b.path));
}

/**
 * zoxide matching: keywords must appear in order, and the last keyword must
 * match within the final path component.
 */
export function matchesKeywords(path: string, kws: readonly string[]): boolean {
  if (kws.length === 0) return true;
  const lower = path.toLowerCase();
  let from = 0;
  for (const kw of kws) {
    const i = lower.indexOf(kw, from);
    if (i === -1) return false;
    from = i + kw.length;
  }
  const lastSep = Math.max(lower.lastIndexOf("/"), lower.lastIndexOf("\\"));
  return lower.slice(lastSep + 1).includes(kws[kws.length - 1]);
}

const STORAGE_KEY = "gear.dirFrecency";

export function loadDirDb(): DirEntry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is DirEntry =>
        !!e && typeof e.path === "string" && typeof e.rank === "number" && typeof e.last === "number",
    );
  } catch {
    return [];
  }
}

export function saveDirDb(db: readonly DirEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // Non-essential.
  }
}
