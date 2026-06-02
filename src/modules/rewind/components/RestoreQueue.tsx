import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { chronicleRestoreFile, type TimelineEvent } from "../lib/api";
import { formatTime } from "../lib/format";

interface RestoreQueueProps {
  workspaceRoot: string | null;
  candidates: readonly TimelineEvent[];
  atTs: number;
}

type RowStatus = "idle" | "restoring" | "done" | "error";

/**
 * Lists the file edits recoverable at the current scrub position and offers a
 * one-click restore. Restore reconstructs the past content via Chronicle, then
 * writes it back through the normal file-write path (which itself records a new
 * timeline event — so a restore is reversible).
 */
export function RestoreQueue({
  workspaceRoot,
  candidates,
  atTs,
}: RestoreQueueProps) {
  const [status, setStatus] = useState<Record<number, RowStatus>>({});

  const restore = async (e: TimelineEvent) => {
    if (workspaceRoot === null || e.file_path === null) return;
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
    } catch {
      setStatus((s) => ({ ...s, [e.id]: "error" }));
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
    <ul className="flex flex-col gap-0.5">
      {candidates.map((e) => {
        const st = status[e.id] ?? "idle";
        return (
          <li
            key={e.id}
            className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-[11px] hover:bg-accent/40"
          >
            <span className="min-w-0 flex-1 truncate" title={e.file_path ?? ""}>
              {e.file_path}
            </span>
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
  );
}
