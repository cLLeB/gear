import { invoke } from "@tauri-apps/api/core";

/** A single event on the session timeline, as returned by the Rust `chronicle_range` command. */
export interface TimelineEvent {
  id: number;
  ts: number;
  kind: TimelineKind;
  actor: string;
  file_path: string | null;
  summary: string;
  payload: unknown;
  parent_id: number | null;
}

export type TimelineKind =
  | "cmd"
  | "cmd_output"
  | "file"
  | "git"
  | "agent";

/** Fetch timeline events within a timestamp window (inclusive) for a workspace. */
export function chronicleRange(
  workspaceRoot: string,
  fromTs: number,
  toTs: number,
  limit = 500,
): Promise<TimelineEvent[]> {
  return invoke<TimelineEvent[]>("chronicle_range", {
    workspaceRoot,
    fromTs,
    toTs,
    limit,
  });
}

/**
 * Reconstruct the text content of a file as it existed at-or-before `atTs`.
 * Returns the content; the caller decides whether to write it back to disk.
 */
export function chronicleRestoreFile(
  workspaceRoot: string,
  filePath: string,
  atTs: number,
): Promise<string> {
  return invoke<string>("chronicle_restore_file", {
    workspaceRoot,
    filePath,
    atTs,
  });
}

/** Full edit history of a file, most-recent-first — for blame-across-time. */
export function chronicleFileHistory(
  workspaceRoot: string,
  filePath: string,
  limit = 200,
): Promise<TimelineEvent[]> {
  return invoke<TimelineEvent[]>("chronicle_file_history", {
    workspaceRoot,
    filePath,
    limit,
  });
}

/**
 * Reconstruct the whole tracked tree at-or-before `atTs` into an isolated
 * sandbox directory. Returns the sandbox path; the live workspace is untouched.
 */
export function chronicleCheckoutSandbox(
  workspaceRoot: string,
  atTs: number,
): Promise<string> {
  return invoke<string>("chronicle_checkout_sandbox", {
    workspaceRoot,
    atTs,
  });
}

/** Full-text search across the timeline (summaries, commands, file paths).
 * `query` is an FTS5 MATCH expression; results come back newest-first. */
export function chronicleSearch(
  workspaceRoot: string,
  query: string,
  limit = 200,
): Promise<TimelineEvent[]> {
  return invoke<TimelineEvent[]>("chronicle_search", {
    workspaceRoot,
    query,
    limit,
  });
}

/** Outcome of a retention pass: how many events and blobs were reclaimed. */
export interface RetentionReport {
  events_removed: number;
  blobs_removed: number;
}

/**
 * Prune timeline events older than `maxAgeMs` (backend default 7 days when
 * omitted) and garbage-collect orphaned blobs. Best-effort housekeeping.
 */
export function chroniclePrune(
  workspaceRoot: string,
  maxAgeMs?: number,
): Promise<RetentionReport> {
  return invoke<RetentionReport>("chronicle_prune", {
    workspaceRoot,
    maxAgeMs: maxAgeMs ?? null,
  });
}

/** Record an AI-agent step so manual and agent actions share one timeline. */
export function chronicleRecordAgent(
  workspaceRoot: string,
  agentId: string,
  step: string,
  tool?: string,
  outcome?: string,
): Promise<void> {
  return invoke<void>("chronicle_record_agent", {
    workspaceRoot,
    agentId,
    step,
    tool: tool ?? null,
    outcome: outcome ?? null,
  });
}
