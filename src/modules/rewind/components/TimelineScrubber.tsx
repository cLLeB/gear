import { useMemo } from "react";
import type { TimelineEvent } from "../lib/api";
import {
  KIND_COLOR,
  KIND_LABEL,
  eventLabel,
  formatTime,
  positionInRange,
} from "../lib/format";

interface TimelineScrubberProps {
  events: readonly TimelineEvent[];
  rangeFrom: number;
  rangeTo: number;
  scrubTs: number | null;
  onScrub: (ts: number) => void;
}

/**
 * A slim horizontal timeline. Each captured event is a dot positioned by its
 * timestamp within [rangeFrom, rangeTo]; clicking the track sets the scrub
 * position to the nearest event.
 */
export function TimelineScrubber({
  events,
  rangeFrom,
  rangeTo,
  scrubTs,
  onScrub,
}: TimelineScrubberProps) {
  const markers = useMemo(
    () =>
      events.map((e) => ({
        event: e,
        left: positionInRange(e.ts, rangeFrom, rangeTo),
      })),
    [events, rangeFrom, rangeTo],
  );

  const scrubLeft =
    scrubTs === null ? 1 : positionInRange(scrubTs, rangeFrom, rangeTo);

  const onTrackClick = (clientX: number, target: HTMLDivElement) => {
    const rect = target.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const ts = rangeFrom + frac * (rangeTo - rangeFrom);
    // Snap to the nearest event so the scrubber lands on real state.
    let nearest = ts;
    let best = Number.POSITIVE_INFINITY;
    for (const e of events) {
      const d = Math.abs(e.ts - ts);
      if (d < best) {
        best = d;
        nearest = e.ts;
      }
    }
    onScrub(nearest);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[10.5px] text-muted-foreground">
        <span>{formatTime(rangeFrom)}</span>
        <span>
          {scrubTs === null ? "now" : formatTime(scrubTs)}
          {events.length > 0 ? ` · ${events.length} events` : ""}
        </span>
        <span>{formatTime(rangeTo)}</span>
      </div>

      <div
        role="slider"
        aria-label="Session timeline"
        aria-valuemin={rangeFrom}
        aria-valuemax={rangeTo}
        aria-valuenow={scrubTs ?? rangeTo}
        tabIndex={0}
        onClick={(e) => onTrackClick(e.clientX, e.currentTarget)}
        className="relative h-7 cursor-pointer rounded-md border border-border/60 bg-card/40"
      >
        {markers.map(({ event, left }) => (
          <span
            key={event.id}
            title={`${formatTime(event.ts)} — ${eventLabel(event)}`}
            style={{ left: `${left * 100}%` }}
            className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
              KIND_COLOR[event.kind] ?? "bg-muted-foreground"
            }`}
          />
        ))}
        {/* Scrub head */}
        <span
          style={{ left: `${scrubLeft * 100}%` }}
          className="pointer-events-none absolute top-0 h-full w-0.5 -translate-x-1/2 bg-foreground/70"
        />
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {(Object.keys(KIND_LABEL) as Array<keyof typeof KIND_LABEL>).map(
          (kind) => (
            <span key={kind} className="flex items-center gap-1">
              <span
                className={`h-2 w-2 rounded-full ${KIND_COLOR[kind]}`}
                aria-hidden
              />
              {KIND_LABEL[kind]}
            </span>
          ),
        )}
      </div>
    </div>
  );
}
