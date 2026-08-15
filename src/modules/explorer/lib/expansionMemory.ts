// Which folders the user had open in the sidebar, remembered per workspace root
// so reopening Gear restores the same shape of tree.
//
// Kept in localStorage rather than the spaces store: it is cheap, purely
// cosmetic, and losing it costs the user one click.

const KEY = "gear-explorer-expanded";

/** Folders remembered per root. Deep trees hit this long before it matters. */
export const MAX_REMEMBERED = 64;

/** Roots kept at once, so switching between projects does not lose the last. */
export const MAX_ROOTS = 12;

export type ExpansionMemory = Record<string, string[]>;

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Narrows the stored blob. The pre-0.8.8 format was a flat `string[]` of the
 * last 8 expanded paths with no root grouping; it is read as belonging to no
 * root and simply dropped, which costs the user one click.
 */
export function parseMemory(raw: unknown): ExpansionMemory {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: ExpansionMemory = {};
  for (const [root, paths] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(paths)) continue;
    const clean = paths.filter(
      (p): p is string => typeof p === "string" && p.length > 0,
    );
    if (clean.length > 0) out[root] = clean.slice(0, MAX_REMEMBERED);
  }
  return out;
}

/** Returns a new memory with `paths` recorded for `root`. Never mutates. */
export function withExpansion(
  memory: ExpansionMemory,
  root: string,
  paths: Iterable<string>,
): ExpansionMemory {
  const kept = [...new Set(paths)].slice(0, MAX_REMEMBERED);
  // Most-recently-used root first, so eviction drops the stalest project.
  const roots = [root, ...Object.keys(memory).filter((r) => r !== root)].slice(
    0,
    MAX_ROOTS,
  );
  const next: ExpansionMemory = {};
  for (const r of roots) {
    const value = r === root ? kept : memory[r];
    if (value && value.length > 0) next[r] = value;
  }
  return next;
}

export function readMemory(
  storage: StorageLike | null = defaultStorage(),
): ExpansionMemory {
  if (!storage) return {};
  try {
    const raw = storage.getItem(KEY);
    return raw ? parseMemory(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function writeMemory(
  memory: ExpansionMemory,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // Storage full or disabled — the tree just opens collapsed next time.
  }
}

/** The remembered folders for `root`, minus any that no longer sit under it. */
export function recallExpansion(
  root: string,
  storage: StorageLike | null = defaultStorage(),
): Set<string> {
  if (!root) return new Set();
  const remembered = readMemory(storage)[root] ?? [];
  return new Set(remembered.filter((p) => p === root || isUnder(p, root)));
}

/** Replaces the remembered folders for `root`. */
export function rememberExpansion(
  root: string,
  paths: Iterable<string>,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!root) return;
  writeMemory(withExpansion(readMemory(storage), root, paths), storage);
}

function isUnder(path: string, root: string): boolean {
  const sep = root.includes("\\") ? "\\" : "/";
  return path.startsWith(`${root}/`) || path.startsWith(root + sep);
}
