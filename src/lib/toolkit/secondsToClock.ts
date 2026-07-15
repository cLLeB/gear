export interface ClockOptions {
  /** Always include hours even when zero. Defaults to false. */
  forceHours?: boolean;
}

/**
 * Format a number of seconds as a stopwatch clock: "m:ss" or "h:mm:ss".
 * Negative inputs are clamped to zero.
 */
export function secondsToClock(totalSeconds: number, options: ClockOptions = {}): string {
  const { forceHours = false } = options;
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;

  const pad = (n: number) => n.toString().padStart(2, "0");
  if (hours > 0 || forceHours) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${minutes}:${pad(seconds)}`;
}

/** Parse an "h:mm:ss" / "m:ss" clock string back into seconds. */
export function clockToSeconds(clock: string): number | null {
  const parts = clock.split(":").map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}
