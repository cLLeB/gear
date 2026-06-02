import { useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  ClockIcon,
  Delete02Icon,
  FolderOpenIcon,
} from "@hugeicons/core-free-icons";
import { getLaunchDir } from "@/lib/launchDir";
import { chronicleCheckoutSandbox } from "../lib/api";
import { restoreCandidates, useRewindStore } from "../store/rewindStore";
import { TimelineScrubber } from "./TimelineScrubber";
import { TimelineSearch } from "./TimelineSearch";
import { RestoreQueue } from "./RestoreQueue";
import { FileTimeline } from "./FileTimeline";

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
  const query = useRewindStore((s) => s.query);
  const searching = useRewindStore((s) => s.searching);
  const searchResults = useRewindStore((s) => s.searchResults);
  const search = useRewindStore((s) => s.search);
  const clearSearch = useRewindStore((s) => s.clearSearch);
  const prune = useRewindStore((s) => s.prune);

  // (Re)load the timeline whenever the panel opens, and reset any prior search.
  useEffect(() => {
    if (!open) return;
    clearSearch();
    const root = getLaunchDir();
    if (root) void load(root);
  }, [open, load, clearSearch]);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [sandboxMsg, setSandboxMsg] = useState<string | null>(null);
  const [sandboxing, setSandboxing] = useState(false);
  const [pruning, setPruning] = useState(false);

  const atTs = scrubTs ?? rangeTo;
  const candidates = useMemo(
    () => restoreCandidates(events, atTs),
    [events, atTs],
  );

  const checkoutSandbox = async () => {
    if (!workspaceRoot) return;
    setSandboxing(true);
    setSandboxMsg(null);
    try {
      const path = await chronicleCheckoutSandbox(workspaceRoot, atTs);
      setSandboxMsg(`Sandbox created: ${path}`);
    } catch (e) {
      setSandboxMsg(
        `Sandbox failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setSandboxing(false);
    }
  };

  const runPrune = async () => {
    setPruning(true);
    setSandboxMsg(null);
    try {
      const report = await prune();
      setSandboxMsg(
        report === null
          ? "Pruned old events and reclaimed orphaned blobs."
          : `Pruned ${report.events_removed} events, ${report.blobs_removed} blobs, ${report.sandboxes_removed} sandboxes.`,
      );
    } finally {
      setPruning(false);
    }
  };

  // When a search result is picked, jump the scrubber there and drop back to
  // the live timeline so the chosen point is in view.
  const jumpTo = (ts: number) => {
    clearSearch();
    setSelectedFile(null);
    setScrub(ts);
  };

  const openFileFromSearch = (filePath: string) => {
    clearSearch();
    setSelectedFile(filePath);
  };

  if (!open) return null;

  return (
    <div className="absolute bottom-10 left-1/2 z-50 flex w-[min(720px,92vw)] -translate-x-1/2 flex-col gap-3 rounded-lg border border-border/70 bg-popover/95 p-3 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[12px] font-medium">
          <HugeiconsIcon icon={ClockIcon} size={14} strokeWidth={2} />
          <span>Rewind — session timeline</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={sandboxing || !workspaceRoot || events.length === 0}
            onClick={() => void checkoutSandbox()}
            title="Reconstruct the whole tree at this point into an isolated sandbox"
            className="flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 text-[10.5px] hover:bg-accent disabled:opacity-50"
          >
            <HugeiconsIcon icon={FolderOpenIcon} size={12} strokeWidth={2} />
            {sandboxing ? "Checking out…" : "Checkout to sandbox"}
          </button>
          <button
            type="button"
            disabled={pruning || !workspaceRoot}
            onClick={() => void runPrune()}
            title="Prune events older than 7 days and reclaim orphaned blobs"
            className="flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 text-[10.5px] hover:bg-accent disabled:opacity-50"
          >
            <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={2} />
            {pruning ? "Pruning…" : "Prune"}
          </button>
          <button
            type="button"
            aria-label="Close timeline"
            onClick={() => setOpen(false)}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {sandboxMsg ? (
        <p className="break-all rounded bg-muted/40 px-2 py-1 text-[10.5px] text-muted-foreground">
          {sandboxMsg}
        </p>
      ) : null}

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
          <TimelineSearch
            query={query}
            searching={searching}
            results={searchResults}
            onQueryChange={search}
            onClear={clearSearch}
            onPick={jumpTo}
            onSelectFile={openFileFromSearch}
          />
          {searchResults === null ? (
            <>
              <TimelineScrubber
                events={events}
                rangeFrom={rangeFrom}
                rangeTo={rangeTo}
                scrubTs={scrubTs}
                onScrub={setScrub}
              />
              <div className="max-h-56 overflow-y-auto border-t border-border/50 pt-2">
                {selectedFile && workspaceRoot ? (
                  <FileTimeline
                    workspaceRoot={workspaceRoot}
                    filePath={selectedFile}
                    onBack={() => setSelectedFile(null)}
                  />
                ) : (
                  <>
                    <p className="px-1 pb-1 text-[10.5px] uppercase tracking-wide text-muted-foreground">
                      Recoverable at {scrubTs === null ? "now" : "this point"} ·
                      click a file for its history
                    </p>
                    <RestoreQueue
                      workspaceRoot={workspaceRoot}
                      candidates={candidates}
                      atTs={atTs}
                      onSelectFile={setSelectedFile}
                    />
                  </>
                )}
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
