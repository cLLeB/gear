// Recently-used command ids for the palette, most recent first. VS Code and
// JetBrains both surface these above everything else on an empty query; with
// a query they act as a tie-breaker so a command you just ran wins over an
// equally good textual match.

const STORAGE_KEY = "gear.commandPalette.recent";
export const MAX_RECENT = 8;

/** Move `id` to the front, dropping duplicates and anything past `max`. */
export function recordRecent(list: readonly string[], id: string, max = MAX_RECENT): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}

/**
 * Score bonus for a recently used command: the most recent gets the largest
 * boost, fading linearly. Small enough that a clearly better textual match
 * still wins.
 */
export function recencyBonus(list: readonly string[], id: string): number {
  const i = list.indexOf(id);
  if (i === -1) return 0;
  return ((list.length - i) / list.length) * 0.75;
}

export function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveRecent(list: readonly string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage can be unavailable (private mode, quota); recents are a nicety.
  }
}
