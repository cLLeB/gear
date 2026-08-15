import { LazyStore } from "@tauri-apps/plugin-store";

// Per-file cursor and scroll position, so a restored editor tab opens where the
// user left it rather than at line 1. Keyed by absolute path and capped, since
// this accumulates an entry for every file ever opened.

const STORE_PATH = "gear-editor-view.json";
const KEY = "views";

/** How many files keep a remembered position. Oldest touched are dropped. */
export const VIEW_STATE_LIMIT = 300;

export type EditorViewState = {
  /** Selection anchor offset in the document. */
  anchor: number;
  /** Selection head offset; equals `anchor` for a plain cursor. */
  head: number;
  scrollTop: number;
  /** Last-touched timestamp, used to decide what to evict. */
  at: number;
};

export type ViewStateMap = Record<string, EditorViewState>;

function isFiniteNonNegative(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/** Narrows one untrusted entry, returning null rather than throwing. */
export function parseViewState(raw: unknown): EditorViewState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isFiniteNonNegative(r.anchor)) return null;
  if (!isFiniteNonNegative(r.head)) return null;
  if (!isFiniteNonNegative(r.scrollTop)) return null;
  return {
    anchor: r.anchor,
    head: r.head,
    scrollTop: r.scrollTop,
    at: isFiniteNonNegative(r.at) ? r.at : 0,
  };
}

/** Drops malformed entries and keeps the `limit` most recently touched. */
export function pruneViewStates(raw: unknown, limit: number): ViewStateMap {
  if (typeof raw !== "object" || raw === null) return {};
  const parsed: Array<[string, EditorViewState]> = [];
  for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
    const state = parseViewState(value);
    if (state) parsed.push([path, state]);
  }
  parsed.sort((a, b) => b[1].at - a[1].at);
  return Object.fromEntries(parsed.slice(0, Math.max(0, limit)));
}

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 1000 });

let cache: ViewStateMap | null = null;

async function readAll(): Promise<ViewStateMap> {
  if (cache) return cache;
  try {
    cache = pruneViewStates(await store.get(KEY), VIEW_STATE_LIMIT);
  } catch {
    cache = {};
  }
  return cache;
}

export async function loadViewState(
  path: string,
): Promise<EditorViewState | null> {
  if (!path) return null;
  return (await readAll())[path] ?? null;
}

export async function saveViewState(
  path: string,
  state: Omit<EditorViewState, "at">,
): Promise<void> {
  if (!path) return;
  const all = await readAll();
  cache = pruneViewStates(
    { ...all, [path]: { ...state, at: Date.now() } },
    VIEW_STATE_LIMIT,
  );
  try {
    await store.set(KEY, cache);
  } catch {
    // Position memory is a convenience; never fail an edit over it.
  }
}
