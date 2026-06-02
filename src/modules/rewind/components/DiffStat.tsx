import type { TimelineEvent } from "../lib/api";
import { fileDiffStat } from "../lib/format";

interface DiffStatProps {
  event: TimelineEvent;
}

/**
 * Compact `+added −removed` badge for a file event, plus an op marker for
 * non-modify ops (created / deleted). Renders nothing for non-file events.
 */
export function DiffStat({ event }: DiffStatProps) {
  const stat = fileDiffStat(event);
  if (stat === null) return null;

  if (stat.op === "deleted") {
    return <span className="shrink-0 text-[10px] text-rose-500">deleted</span>;
  }
  if (stat.op === "created") {
    return <span className="shrink-0 text-[10px] text-emerald-500">created</span>;
  }
  if (stat.added === 0 && stat.removed === 0) return null;

  return (
    <span className="shrink-0 font-mono text-[10px] tabular-nums">
      {stat.added > 0 ? (
        <span className="text-emerald-500">+{stat.added}</span>
      ) : null}
      {stat.added > 0 && stat.removed > 0 ? " " : ""}
      {stat.removed > 0 ? (
        <span className="text-rose-500">−{stat.removed}</span>
      ) : null}
    </span>
  );
}
