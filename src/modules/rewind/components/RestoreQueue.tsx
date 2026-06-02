import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { chronicleRestoreFile, type TimelineEvent } from "../lib/api";
import { formatTime } from "../lib/format";
import { DiffStat } from "./DiffStat";

interface RestoreQueueProps {
  workspaceRoot: string | null;
  candidates: readonly TimelineEvent[];
  atTs: number;
  /** Open the blame-across-time view for a file. */
  onSelectFile?: (filePath: string) => void;
}

type RowStatus = "idle" | "restoring" | "done" | "error";

/**
 * Lists the file edits recoverable at the current scrub position and offers a
 * one-click restore. Restore reconstructs the past content via Chronicle, then
 * writes it back through the normal file-write path (which itself records a new
 * timeline event — so a restore is reversible).
 *
 * "Restore all" promotes the entire scrub point to live by restoring every
 * candidate file. It's reversible (each write is recorded) but touches many
 * files at once, so it's gated behind an inline confirmation.
 */
export function RestoreQueue({
  workspaceRoot,
  candidates,
  atTs,
  onSelectFile,
}: RestoreQueueProps) {
  const [status, setStatus] = useState<Record<number, RowStatus>>({});
  const [confirmAll, setConfirmAll] = useState(false);
  const [restoringAll, setRestoringAll] = useState(false);

  const restore = async (e: TimelineEvent): Promise<boolean> => {
    if (workspaceRoot === null || e.file_path === null) return false;
    setStatus((s) => ({ ...s, [e.id]: "restoring" }));
    try {
      const content = await chronicleRestoreFile(
        workspaceRoot,
        e.file_path,
        atTs,
      );
      await invoke("fs_write_file", {
        path: e.file_path,
        content,
        workspace: currentWorkspaceEnv(),
        source: "rewind",
        workspaceRoot,
      });
      setStatus((s) => ({ ...s, [e.id]: "done" }));
      return true;
    } catch {
      setStatus((s) => ({ ...s, [e.id]: "error" }));
      return false;
    }
  };

  const restoreAll = async () => {
    setConfirmAll(false);
    setRestoringAll(true);
    try {
      // Sequential so we never flood the write path with parallel saves.
      for (const e of candidates) {
        await restore(e);
      }
    } finally {
      setRestoringAll(false);
    }
  };

  if (candidates.length === 0) {
    return (
      <p className="px-1 py-3 text-[11px] text-muted-foreground">
        No recoverable file edits at this point yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-end gap-1.5 px-1">
        {confirmAll ? (
          <>
            <span className="mr-auto text-[10.5px] text-muted-foreground">
              Restore all {candidates.length} files to this point?
            </span>
            <button
              type="button"
              onClick={() => void restoreAll()}
              className="rounded border border-border/60 px-1.5 py-0.5 text-[10.5px] hover:bg-accent"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirmAll(false)}
              className="rounded border border-border/60 px-1.5 py-0.5 text-[10.5px] hover:bg-accent"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={restoringAll || workspaceRoot === null}
            onClick={() => setConfirmAll(true)}
            title="Restore every file shown to its state at this point (reversible)"
            className="rounded border border-border/60 px-1.5 py-0.5 text-[10.5px] hover:bg-accent disabled:opacity-50"
          >
            {restoringAll
              ? "Restoring all…"
              : `Restore all (${candidates.length})`}
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-0.5">
        {candidates.map((e) => {
          const st = status[e.id] ?? "idle";
          return (
            <li
              key={e.id}
              className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-[11px] hover:bg-accent/40"
            >
              <button
                type="button"
                onClick={() => e.file_path && onSelectFile?.(e.file_path)}
                className="min-w-0 flex-1 truncate text-left hover:underline"
                title={`${e.file_path} — view history`}
              >
                {e.file_path}
              </button>
              <DiffStat event={e} />
              <span className="shrink-0 text-muted-foreground">
                {formatTime(e.ts)}
              </span>
              <button
                type="button"
                disabled={st === "restoring" || st === "done"}
                onClick={() => void restore(e)}
                className="shrink-0 rounded border border-border/60 px-1.5 py-0.5 text-[10.5px] hover:bg-accent disabled:opacity-50"
              >
                {st === "restoring"
                  ? "Restoring…"
                  : st === "done"
                    ? "Restored"
                    : st === "error"
                      ? "Retry"
                      : "Restore"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
