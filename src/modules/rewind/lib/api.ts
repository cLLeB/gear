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
