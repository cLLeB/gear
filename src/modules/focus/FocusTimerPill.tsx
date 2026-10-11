import { useEffect, useState } from "react";
import { formatRemaining, stopFocus, useFocusTimer } from "./focusTimer";

/** Countdown in the status bar while a focus timer runs; click to stop. */
export function FocusTimerPill() {
  const { label, endsAt, totalMs } = useFocusTimer();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endsAt]);
  if (!endsAt) return null;
  const left = endsAt - now;
  const pct = totalMs ? Math.min(100, Math.max(0, 100 - (left / totalMs) * 100)) : 0;
  return (
    <button
      type="button"
      onClick={() => stopFocus()}
      title={`${label} — click to stop`}
      className="relative flex shrink-0 cursor-pointer items-center gap-1 overflow-hidden rounded-full bg-violet-500/10 px-2 py-0.5 text-[10.5px] font-medium tabular-nums text-violet-700 hover:bg-violet-500/20 dark:text-violet-300"
    >
      <span className="absolute inset-y-0 left-0 bg-violet-500/15" style={{ width: `${pct}%` }} />
      <span className="relative">⏱ {formatRemaining(left)}</span>
    </button>
  );
}
