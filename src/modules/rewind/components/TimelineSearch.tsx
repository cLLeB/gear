import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import type { TimelineEvent } from "../lib/api";
import { KIND_COLOR, KIND_LABEL, eventLabel, formatTime } from "../lib/format";

interface TimelineSearchProps {
  query: string;
  searching: boolean;
  /** Null when no search is active; otherwise the hits (possibly empty). */
  results: TimelineEvent[] | null;
  onQueryChange: (query: string) => void;
  onClear: () => void;
  /** Jump the scrubber to a result's timestamp. */
  onPick: (ts: number) => void;
  /** Open blame-across-time for a file result. */
  onSelectFile: (filePath: string) => void;
}

/**
 * Full-text search box over the timeline plus its results list. Backed by the
 * FTS5 index in the Chronicle store, so it matches commands, summaries, and
 * paths across the whole recorded session — not just the loaded window.
 */
export function TimelineSearch({
  query,
  searching,
  results,
  onQueryChange,
  onClear,
  onPick,
  onSelectFile,
}: TimelineSearchProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-card/40 px-2 py-1">
        <HugeiconsIcon
          icon={Search01Icon}
          size={13}
          strokeWidth={2}
          className="text-muted-foreground"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search timeline — commands, files, summaries…"
          className="min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground"
          aria-label="Search timeline"
        />
        {query.length > 0 ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={onClear}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
          </button>
        ) : null}
      </div>

      {results !== null ? (
        <div className="max-h-56 overflow-y-auto border-t border-border/50 pt-2">
          {searching ? (
            <p className="px-1 py-2 text-[11px] text-muted-foreground">
              Searching…
            </p>
          ) : results.length === 0 ? (
            <p className="px-1 py-2 text-[11px] text-muted-foreground">
              No matches for "{query.trim()}".
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {results.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center gap-2 rounded px-1.5 py-1 text-[11px] hover:bg-accent/40"
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      KIND_COLOR[e.kind] ?? "bg-muted-foreground"
                    }`}
                    title={KIND_LABEL[e.kind] ?? e.kind}
                    aria-hidden
                  />
                  <span className="shrink-0 text-muted-foreground">
                    {formatTime(e.ts)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onPick(e.ts)}
                    className="min-w-0 flex-1 truncate text-left hover:underline"
                    title="Jump the scrubber to this point"
                  >
                    {eventLabel(e)}
                  </button>
                  {e.file_path !== null ? (
                    <button
                      type="button"
                      onClick={() => onSelectFile(e.file_path as string)}
                      className="shrink-0 rounded border border-border/60 px-1.5 py-0.5 text-[10.5px] hover:bg-accent"
                      title="View this file's history"
                    >
                      History
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
