// Command timeline model: every command any terminal finished, laid out on a
// time axis with one lane per pane, plus the numbers that make the picture
// useful (what was slow, what keeps failing). Pure functions; the store and
// the pane live in TimelinePane.tsx.

export interface TimelineEntry {
  id: number;
  leafId: number;
  command: string;
  exitCode: number | null;
  startedAt: number;
  finishedAt: number;
  cwd: string | null;
}

export type Outcome = "ok" | "failed" | "unknown";

export function outcomeOf(e: Pick<TimelineEntry, "exitCode">): Outcome {
  if (e.exitCode === null) return "unknown";
  return e.exitCode === 0 ? "ok" : "failed";
}

export interface Window {
  from: number;
  to: number;
}

/** Entries that overlap the window, optionally filtered by text and failures. */
export function filterEntries(
  entries: readonly TimelineEntry[],
  win: Window,
  opts: { query?: string; failedOnly?: boolean } = {},
): TimelineEntry[] {
  const q = opts.query?.trim().toLowerCase() ?? "";
  return entries.filter(
    (e) =>
      e.finishedAt >= win.from &&
      e.startedAt <= win.to &&
      (!opts.failedOnly || outcomeOf(e) === "failed") &&
      (!q || e.command.toLowerCase().includes(q) || (e.cwd ?? "").toLowerCase().includes(q)),
  );
}

/** One lane per pane, in the order panes first appear. */
export function lanesOf(entries: readonly TimelineEntry[]): number[] {
  const seen: number[] = [];
  for (const e of [...entries].sort((a, b) => a.startedAt - b.startedAt)) {
    if (!seen.includes(e.leafId)) seen.push(e.leafId);
  }
  return seen;
}

const RUNNERS = new Set(["npx", "pnpx", "bunx", "uvx"]);

/** The command's program and first argument, for grouping `npm test` runs together. */
export function commandKey(command: string): string {
  const words = command.trim().split(/\s+/).filter(Boolean);
  // Skip leading env assignments (FOO=1 npm test).
  while (words.length > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
  const name = (w: string) => w.replace(/^.*[\\/]/, "").replace(/\.(exe|cmd|bat|ps1)$/i, "");
  // Package runners: group `npx vitest run` with `vitest run`.
  if (words.length > 1 && RUNNERS.has(name(words[0]))) words.shift();
  const [prog = "", arg] = words;
  const base = name(prog);
  return arg && !arg.startsWith("-") ? `${base} ${arg}` : base;
}

export interface CommandGroup {
  key: string;
  runs: number;
  failures: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
  lastExitCode: number | null;
}

export interface TimelineSummary {
  count: number;
  failures: number;
  busyMs: number;
  slowest: TimelineEntry[];
  groups: CommandGroup[];
}

/** Busy time is the union of all command intervals, so parallel panes don't double count. */
export function busyTime(entries: readonly TimelineEntry[]): number {
  const spans = entries.map((e) => [e.startedAt, e.finishedAt] as const).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curFrom = -1;
  let curTo = -1;
  for (const [from, to] of spans) {
    if (from > curTo) {
      if (curTo > curFrom) total += curTo - curFrom;
      curFrom = from;
      curTo = to;
    } else if (to > curTo) {
      curTo = to;
    }
  }
  if (curTo > curFrom) total += curTo - curFrom;
  return total;
}

export function summarize(entries: readonly TimelineEntry[], top = 5): TimelineSummary {
  const groups = new Map<string, CommandGroup>();
  for (const e of [...entries].sort((a, b) => a.finishedAt - b.finishedAt)) {
    const key = commandKey(e.command);
    if (!key) continue;
    const ms = e.finishedAt - e.startedAt;
    const g = groups.get(key) ?? { key, runs: 0, failures: 0, totalMs: 0, avgMs: 0, maxMs: 0, lastExitCode: null };
    g.runs += 1;
    g.failures += outcomeOf(e) === "failed" ? 1 : 0;
    g.totalMs += ms;
    g.maxMs = Math.max(g.maxMs, ms);
    g.lastExitCode = e.exitCode;
    groups.set(key, g);
  }
  for (const g of groups.values()) g.avgMs = g.totalMs / g.runs;
  return {
    count: entries.length,
    failures: entries.filter((e) => outcomeOf(e) === "failed").length,
    busyMs: busyTime(entries),
    slowest: [...entries].sort((a, b) => b.finishedAt - b.startedAt - (a.finishedAt - a.startedAt)).slice(0, top),
    groups: [...groups.values()].sort((a, b) => b.totalMs - a.totalMs),
  };
}

const STEPS_MS = [1, 2, 5, 10, 15, 30].map((s) => s * 1000).concat([1, 2, 5, 10, 15, 30].map((m) => m * 60_000), [1, 2, 3, 6, 12].map((h) => h * 3_600_000));

/** Round axis ticks: at most `max` of them across the window. */
export function axisTicks(win: Window, max = 8): number[] {
  const span = Math.max(1, win.to - win.from);
  const step = STEPS_MS.find((s) => span / s <= max) ?? 86_400_000;
  const out: number[] = [];
  for (let t = Math.ceil(win.from / step) * step; t <= win.to; t += step) out.push(t);
  return out;
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
