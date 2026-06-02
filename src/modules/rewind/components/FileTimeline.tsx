import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";
import {
  chronicleFileHistory,
  chronicleRestoreFile,
  type TimelineEvent,
} from "../lib/api";
import { formatTime } from "../lib/format";
import { DiffStat } from "./DiffStat";

interface FileTimelineProps {
  workspaceRoot: string;
  filePath: string;
  onBack: () => void;
}

/**
 * Blame-across-time for a single file: every recorded state it passed through,
 * who/what changed it, with one-click restore of any past version.
 */
export function FileTimeline({
  workspaceRoot,
  filePath,
  onBack,
}: FileTimelineProps) {
  const [history, setHistory] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoredId, setRestoredId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    chronicleFileHistory(workspaceRoot, filePath)
      .then((h) => {
        if (active) setHistory(h);
      })
      .catch(() => {
        if (active) setHistory([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspaceRoot, filePath]);

  const restoreTo = async (e: TimelineEvent) => {
    try {
      const content = await chronicleRestoreFile(workspaceRoot, filePath, e.ts);
      await invoke("fs_write_file", {
        path: filePath,
        content,
        workspace: currentWorkspaceEnv(),
        source: "rewind",
        workspaceRoot,
      });
      setRestoredId(e.id);
    } catch {
      /* surfaced inline below via lack of confirmation */
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[11px]">
        <button
          type="button"
          onClick={onBack}
          className="rounded border border-border/60 px-1.5 py-0.5 hover:bg-accent"
        >
          ← Back
        </button>
        <span className="min-w-0 flex-1 truncate font-medium" title={filePath}>
          {filePath}
        </span>
      </div>

      {loading ? (
        <p className="px-1 py-2 text-[11px] text-muted-foreground">Loading…</p>
      ) : history.length === 0 ? (
        <p className="px-1 py-2 text-[11px] text-muted-foreground">
          No recorded history for this file.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {history.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-[11px] hover:bg-accent/40"
            >
              <span className="shrink-0 text-muted-foreground">
                {formatTime(e.ts)}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {e.actor === "user" ? "you" : e.actor}
              </span>
              <DiffStat event={e} />
              <button
                type="button"
                disabled={restoredId === e.id}
                onClick={() => void restoreTo(e)}
                className="shrink-0 rounded border border-border/60 px-1.5 py-0.5 text-[10.5px] hover:bg-accent disabled:opacity-50"
              >
                {restoredId === e.id ? "Restored" : "Restore"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
