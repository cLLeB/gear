import type { SerializedTab } from "./serialize";

// Gear <= 0.8.7 kept the session in three localStorage keys, saved only terminal
// cwds and editor paths, and dropped the first terminal on restore. Those keys
// are read once on the first launch after upgrading, converted into the spaces
// store, and cleared. Everything here is read-only and disposable — once a user
// has launched once on the new store, this module never does anything again.

const TERMINALS_KEY = "Gear.terminal.sessions";
const EDITORS_KEY = "Gear.editor.sessions";
const SPACES_META_KEY = "Gear.spaces.meta";

/** The slice of `Storage` this module needs, so tests can pass a plain object. */
export type StorageLike = Pick<Storage, "getItem" | "removeItem">;

export type LegacySession = {
  /** Serialized tabs per space id, ready to hand to `hydrateTabs`. */
  tabsBySpace: Map<string, SerializedTab[]>;
  activeSpaceId: string | null;
};

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Storage disabled (private mode, sandboxed frame).
    return null;
  }
}

function readJson(storage: StorageLike, key: string): unknown {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// A previous run could persist a Windows extended-length prefix when OSC 7
// reported "//?/C:/Users/..." instead of "C:/Users/...".
function sanitizeCwd(raw: string): string {
  if (raw.startsWith("//?/")) return raw.slice(4);
  if (raw.startsWith("\\\\.\\") || raw.startsWith("\\\\?\\")) return raw.slice(4);
  return raw;
}

function push(
  map: Map<string, SerializedTab[]>,
  spaceId: string,
  tab: SerializedTab,
): void {
  const arr = map.get(spaceId);
  if (arr) arr.push(tab);
  else map.set(spaceId, [tab]);
}

/**
 * Reads the pre-0.8.8 session out of localStorage. Returns null when there is
 * nothing to migrate, so the caller falls through to a fresh-launch terminal.
 */
export function readLegacySession(
  defaultSpaceId: string,
  storage: StorageLike | null = defaultStorage(),
): LegacySession | null {
  if (!storage) return null;
  const tabsBySpace = new Map<string, SerializedTab[]>();

  const terminals = readJson(storage, TERMINALS_KEY);
  if (Array.isArray(terminals)) {
    for (const entry of terminals) {
      if (typeof entry !== "object" || entry === null) continue;
      const rec = entry as Record<string, unknown>;
      if (typeof rec.title !== "string") continue;
      const cwd =
        typeof rec.cwd === "string" ? sanitizeCwd(rec.cwd) : undefined;
      const spaceId =
        typeof rec.spaceId === "string" ? rec.spaceId : defaultSpaceId;
      push(tabsBySpace, spaceId, {
        kind: "terminal",
        tree: { kind: "leaf", ...(cwd !== undefined && { cwd }) },
      });
    }
  }

  // The old format kept no per-space mapping for editors; they all belonged to
  // whichever space was active, which is the default space often enough.
  const editors = readJson(storage, EDITORS_KEY);
  if (Array.isArray(editors)) {
    for (const path of editors) {
      if (typeof path !== "string" || path.length === 0) continue;
      push(tabsBySpace, defaultSpaceId, { kind: "editor", path });
    }
  }

  if (tabsBySpace.size === 0) return null;

  const meta = readJson(storage, SPACES_META_KEY);
  const activeId =
    typeof meta === "object" && meta !== null
      ? (meta as Record<string, unknown>).activeId
      : null;

  return {
    tabsBySpace,
    activeSpaceId: typeof activeId === "string" ? activeId : null,
  };
}

/** Drops the legacy keys so the migration runs exactly once. */
export function clearLegacySession(
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  for (const key of [TERMINALS_KEY, EDITORS_KEY, SPACES_META_KEY]) {
    try {
      storage.removeItem(key);
    } catch {
      // Storage disabled — the migration just repeats next launch, harmlessly.
    }
  }
}
