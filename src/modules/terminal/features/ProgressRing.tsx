import { leafIds } from "../lib/panes";
import type { PaneNode } from "../lib/panes";
import { aggregateProgress, usePaneStatusStore, type PaneProgress } from "./paneStatus";

const COLORS: Record<PaneProgress["state"], string> = {
  normal: "text-primary",
  indeterminate: "text-primary",
  error: "text-destructive",
  paused: "text-amber-500",
  none: "",
};

/** Aggregated OSC 9;4 progress for the panes of a terminal tab, or null. */
export function useTabProgress(tree: PaneNode | null): PaneProgress | null {
  const progress = usePaneStatusStore((s) => s.progress);
  if (!tree) return null;
  const list = leafIds(tree)
    .map((id) => progress[id])
    .filter((p): p is PaneProgress => !!p);
  return aggregateProgress(list);
}

export function ProgressRing({ progress, size = 14 }: { progress: PaneProgress; size?: number }) {
  const r = 5.5;
  const c = 2 * Math.PI * r;
  const indeterminate = progress.state === "indeterminate";
  const dash = indeterminate ? c * 0.3 : (c * progress.value) / 100;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      className={`shrink-0 ${COLORS[progress.state]} ${indeterminate ? "animate-spin" : ""}`}
      role="img"
      aria-label={indeterminate ? "Working" : `${progress.value}% ${progress.state === "error" ? "(error)" : progress.state === "paused" ? "(paused)" : ""}`}
    >
      <title>{indeterminate ? "Working…" : `${progress.value}%`}</title>
      <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      <circle
        cx="7"
        cy="7"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}

/** True when any pane of the tab rang the bell while in the background. */
export function useTabAttention(tree: PaneNode | null): boolean {
  const attention = usePaneStatusStore((s) => s.attention);
  return !!tree && leafIds(tree).some((id) => attention[id]);
}
