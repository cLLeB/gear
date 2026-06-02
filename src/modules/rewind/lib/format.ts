import type { TimelineEvent, TimelineKind } from "./api";

/** Tailwind dot color per event kind, used by the scrubber markers and legend. */
export const KIND_COLOR: Record<TimelineKind, string> = {
  cmd: "bg-sky-500",
  cmd_output: "bg-sky-400/60",
  file: "bg-emerald-500",
  git: "bg-violet-500",
  agent: "bg-amber-500",
};

/** Short human label per kind for the legend / tooltips. */
export const KIND_LABEL: Record<TimelineKind, string> = {
  cmd: "Command",
  cmd_output: "Output",
  file: "File edit",
  git: "Git",
  agent: "Agent",
};

/** A concise one-line label for a timeline event row. */
export function eventLabel(e: TimelineEvent): string {
  if (e.summary.trim().length > 0) return e.summary;
  return KIND_LABEL[e.kind] ?? e.kind;
}

/** Local HH:MM:SS for a timeline timestamp (ms since epoch). */
export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** The shape of a `file` event's payload (mirrors the Rust `EventPayload::File`). */
export interface FileDiffStat {
  op: string;
  added: number;
  removed: number;
}

/**
 * Extract the diff stat from a `file` event's payload, if present. Returns null
 * for non-file events or malformed payloads — the caller renders nothing then.
 */
export function fileDiffStat(e: TimelineEvent): FileDiffStat | null {
  if (e.kind !== "file" || e.payload === null || typeof e.payload !== "object") {
    return null;
  }
  const p = e.payload as Record<string, unknown>;
  const added = typeof p.added === "number" ? p.added : 0;
  const removed = typeof p.removed === "number" ? p.removed : 0;
  const op = typeof p.op === "string" ? p.op : "modified";
  return { op, added, removed };
}

/** Fractional position [0,1] of `ts` within [from,to]; clamped, safe when from==to. */
export function positionInRange(ts: number, from: number, to: number): number {
  if (to <= from) return 0;
  const p = (ts - from) / (to - from);
  return Math.min(1, Math.max(0, p));
}
