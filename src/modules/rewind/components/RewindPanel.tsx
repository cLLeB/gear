import { useEffect, useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, ClockIcon } from "@hugeicons/core-free-icons";
import { getLaunchDir } from "@/lib/launchDir";
import { restoreCandidates, useRewindStore } from "../store/rewindStore";
import { TimelineScrubber } from "./TimelineScrubber";
import { RestoreQueue } from "./RestoreQueue";

/**
 * Floating Rewind panel: the session-time-travel surface. Hosts the timeline
 * scrubber and the restore queue. Opened from the status bar or Ctrl/Cmd+Shift+T.
 */
export function RewindPanel() {
  const open = useRewindStore((s) => s.open);
  const setOpen = useRewindStore((s) => s.setOpen);
  const load = useRewindStore((s) => s.load);
  const loading = useRewindStore((s) => s.loading);
  const error = useRewindStore((s) => s.error);
  const events = useRewindStore((s) => s.events);
  const rangeFrom = useRewindStore((s) => s.rangeFrom);
  const rangeTo = useRewindStore((s) => s.rangeTo);
  const scrubTs = useRewindStore((s) => s.scrubTs);
  const setScrub = useRewindStore((s) => s.setScrub);
  const workspaceRoot = useRewindStore((s) => s.workspaceRoot);

  // (Re)load the timeline whenever the panel opens.
  useEffect(() => {
    if (!open) return;
    const root = getLaunchDir();
    if (root) void load(root);
  }, [open, load]);

  const atTs = scrubTs ?? rangeTo;
  const candidates = useMemo(
    () => restoreCandidates(events, atTs),
    [events, atTs],
  );

  if (!open) return null;

  return (
    <div className="absolute bottom-10 left-1/2 z-50 flex w-[min(720px,92vw)] -translate-x-1/2 flex-col gap-3 rounded-lg border border-border/70 bg-popover/95 p-3 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[12px] font-medium">
          <HugeiconsIcon icon={ClockIcon} size={14} strokeWidth={2} />
          <span>Rewind — session timeline</span>
        </div>
        <button
          type="button"
          aria-label="Close timeline"
          onClick={() => setOpen(false)}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
        </button>
      </div>

      {loading ? (
        <p className="px-1 py-3 text-[11px] text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="px-1 py-3 text-[11px] text-destructive">{error}</p>
      ) : events.length === 0 ? (
        <p className="px-1 py-3 text-[11px] text-muted-foreground">
          Nothing recorded yet. Edit a file or run a command and it'll appear
          here.
        </p>
      ) : (
        <>
          <TimelineScrubber
            events={events}
            rangeFrom={rangeFrom}
            rangeTo={rangeTo}
            scrubTs={scrubTs}
            onScrub={setScrub}
          />
          <div className="max-h-56 overflow-y-auto border-t border-border/50 pt-2">
            <p className="px-1 pb-1 text-[10.5px] uppercase tracking-wide text-muted-foreground">
              Recoverable at {scrubTs === null ? "now" : "this point"}
            </p>
            <RestoreQueue
              workspaceRoot={workspaceRoot}
              candidates={candidates}
              atTs={atTs}
            />
          </div>
        </>
      )}
    </div>
  );
}
