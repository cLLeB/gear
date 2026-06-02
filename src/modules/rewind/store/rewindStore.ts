import { create } from "zustand";
import {
  chroniclePrune,
  chronicleRange,
  chronicleSearch,
  type TimelineEvent,
} from "../lib/api";

/** Default lookback window when opening the timeline: last 24 hours. */
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

interface RewindState {
  open: boolean;
  workspaceRoot: string | null;
  events: TimelineEvent[];
  rangeFrom: number;
  rangeTo: number;
  /** Current scrub position (ms). Null means "live / now". */
  scrubTs: number | null;
  loading: boolean;
  error: string | null;
  /** Active search query. Empty string means "not searching". */
  query: string;
  /** Search hits for `query`; null when no search is active. */
  searchResults: TimelineEvent[] | null;
  searching: boolean;

  setOpen: (open: boolean) => void;
  toggle: () => void;
  setScrub: (ts: number | null) => void;
  load: (workspaceRoot: string) => Promise<void>;
  search: (query: string) => Promise<void>;
  clearSearch: () => void;
  prune: () => Promise<void>;
}

export const useRewindStore = create<RewindState>((set, get) => ({
  open: false,
  workspaceRoot: null,
  events: [],
  rangeFrom: 0,
  rangeTo: 0,
  scrubTs: null,
  loading: false,
  error: null,
  query: "",
  searchResults: null,
  searching: false,

  setOpen: (open) => set({ open }),

  toggle: () => set((s) => ({ open: !s.open })),

  setScrub: (ts) => set({ scrubTs: ts }),

  load: async (workspaceRoot) => {
    set({ loading: true, error: null, workspaceRoot });
    const to = Date.now();
    const from = to - DEFAULT_WINDOW_MS;
    try {
      const events = await chronicleRange(workspaceRoot, from, to, 1000);
      set({ events, rangeFrom: from, rangeTo: to, loading: false });
    } catch (e) {
      set({
        events: [],
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  search: async (query) => {
    const trimmed = query.trim();
    set({ query });
    const { workspaceRoot } = get();
    if (trimmed.length === 0 || workspaceRoot === null) {
      set({ searchResults: null, searching: false });
      return;
    }
    set({ searching: true });
    try {
      const results = await chronicleSearch(workspaceRoot, trimmed, 200);
      // Ignore stale responses if the query changed while we awaited.
      if (get().query === query) set({ searchResults: results, searching: false });
    } catch {
      if (get().query === query) set({ searchResults: [], searching: false });
    }
  },

  clearSearch: () => set({ query: "", searchResults: null, searching: false }),

  prune: async () => {
    const { workspaceRoot } = get();
    if (workspaceRoot === null) return;
    try {
      await chroniclePrune(workspaceRoot);
      await get().load(workspaceRoot);
    } catch {
      /* best-effort housekeeping; surfaced via the unchanged timeline */
    }
  },
}));

/** File events at-or-before `atTs`, most-recent-first, deduped by path — the restore candidates. */
export function restoreCandidates(
  events: readonly TimelineEvent[],
  atTs: number,
): TimelineEvent[] {
  const seen = new Set<string>();
  const out: TimelineEvent[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind !== "file" || e.file_path === null) continue;
    if (e.ts > atTs) continue;
    if (seen.has(e.file_path)) continue;
    seen.add(e.file_path);
    out.push(e);
  }
  return out;
}
