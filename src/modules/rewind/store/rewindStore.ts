import { create } from "zustand";
import { chronicleRange, type TimelineEvent } from "../lib/api";

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

  setOpen: (open: boolean) => void;
  toggle: () => void;
  setScrub: (ts: number | null) => void;
  load: (workspaceRoot: string) => Promise<void>;
}

export const useRewindStore = create<RewindState>((set) => ({
  open: false,
  workspaceRoot: null,
  events: [],
  rangeFrom: 0,
  rangeTo: 0,
  scrubTs: null,
  loading: false,
  error: null,

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
