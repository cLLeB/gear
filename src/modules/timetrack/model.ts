// Time tracking: the stored shape (seconds per day, split by project, language,
// file and kind of work) and the sums the pane shows. Nothing leaves the machine.

export type Kind = "editing" | "terminal" | "other";

export interface Day {
  total: number;
  projects: Record<string, number>;
  languages: Record<string, number>;
  files: Record<string, number>;
  kinds: Partial<Record<Kind, number>>;
}

/** Keyed by local date, "2026-01-31". */
export type Data = Record<string, Day>;

export interface Sample {
  project: string | null;
  language: string | null;
  file: string | null;
  kind: Kind;
}

export const KEEP_DAYS = 400;
const MAX_FILES_PER_DAY = 300;

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const emptyDay = (): Day => ({ total: 0, projects: {}, languages: {}, files: {}, kinds: {} });

function bump(map: Record<string, number>, key: string | null, seconds: number): Record<string, number> {
  return key ? { ...map, [key]: (map[key] ?? 0) + seconds } : map;
}

/** Adds `seconds` of activity to a day. Returns a new object; the input is not changed. */
export function addSample(data: Data, day: string, s: Sample, seconds: number): Data {
  if (seconds <= 0) return data;
  const d = data[day] ?? emptyDay();
  let files = bump(d.files, s.file, seconds);
  const names = Object.keys(files);
  if (names.length > MAX_FILES_PER_DAY) {
    // Drop the least-used file so one day cannot grow without bound.
    const least = names.reduce((a, b) => (files[a] <= files[b] ? a : b));
    const { [least]: _dropped, ...rest } = files;
    files = rest;
  }
  return {
    ...data,
    [day]: {
      total: d.total + seconds,
      projects: bump(d.projects, s.project, seconds),
      languages: bump(d.languages, s.language, seconds),
      files,
      kinds: { ...d.kinds, [s.kind]: (d.kinds[s.kind] ?? 0) + seconds },
    },
  };
}

/** Drops days older than `keep` days before `today`. */
export function prune(data: Data, today: string, keep = KEEP_DAYS): Data {
  const cutoff = dateKey(new Date(new Date(`${today}T12:00:00`).getTime() - keep * 86400000));
  const out: Data = {};
  for (const [k, v] of Object.entries(data)) if (k >= cutoff) out[k] = v;
  return out;
}

/** The last `count` local dates ending with `today`, oldest first. */
export function lastDays(today: string, count: number): string[] {
  const base = new Date(`${today}T12:00:00`).getTime();
  return Array.from({ length: count }, (_, i) => dateKey(new Date(base - (count - 1 - i) * 86400000)));
}

export interface Summary {
  total: number;
  days: { day: string; total: number }[];
  activeDays: number;
  projects: [string, number][];
  languages: [string, number][];
  files: [string, number][];
  kinds: [string, number][];
}

function merge(into: Record<string, number>, from: Record<string, number>): void {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
}

const ranked = (m: Record<string, number>): [string, number][] => Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

export function summarize(data: Data, days: string[]): Summary {
  const projects: Record<string, number> = {};
  const languages: Record<string, number> = {};
  const files: Record<string, number> = {};
  const kinds: Record<string, number> = {};
  let total = 0;
  const perDay = days.map((day) => {
    const d = data[day];
    if (!d) return { day, total: 0 };
    total += d.total;
    merge(projects, d.projects);
    merge(languages, d.languages);
    merge(files, d.files);
    merge(kinds, d.kinds as Record<string, number>);
    return { day, total: d.total };
  });
  return { total, days: perDay, activeDays: perDay.filter((d) => d.total > 0).length, projects: ranked(projects), languages: ranked(languages), files: ranked(files), kinds: ranked(kinds) };
}

/** Consecutive days with any activity, counting back from today (or yesterday, if today is still empty). */
export function streak(data: Data, today: string): number {
  const days = lastDays(today, KEEP_DAYS).reverse();
  let n = 0;
  for (const [i, day] of days.entries()) {
    if ((data[day]?.total ?? 0) > 0) n++;
    else if (i > 0 || n > 0) break;
  }
  return n;
}

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per day and project, for a spreadsheet or an invoice. */
export function toCsv(data: Data, days: string[]): string {
  const rows: (string | number)[][] = [["date", "project", "seconds", "hours"]];
  for (const day of days) {
    const d = data[day];
    if (!d) continue;
    const projects = Object.entries(d.projects).sort((a, b) => a[0].localeCompare(b[0]));
    const named = projects.reduce((a, [, v]) => a + v, 0);
    for (const [p, v] of projects) rows.push([day, p, v, (v / 3600).toFixed(2)]);
    if (d.total - named > 0) rows.push([day, "(no folder)", d.total - named, ((d.total - named) / 3600).toFixed(2)]);
  }
  return `${rows.map((r) => r.map(csvCell).join(",")).join("\n")}\n`;
}

/** Stored data from disk, tolerating anything malformed. */
export function parseData(raw: string | null): Data {
  if (!raw) return {};
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const out: Data = {};
    for (const [k, v] of Object.entries(data as Record<string, Partial<Day>>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v || typeof v.total !== "number") continue;
      out[k] = { total: v.total, projects: v.projects ?? {}, languages: v.languages ?? {}, files: v.files ?? {}, kinds: v.kinds ?? {} };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * How many seconds of a tick count as work: nothing when the window is in the
 * background or the last key press / click is older than `idleAfter`.
 */
export function creditFor(elapsed: number, sinceActivity: number, focused: boolean, idleAfter = 120, maxTick = 90): number {
  if (!focused || sinceActivity > idleAfter) return 0;
  // A long gap means the machine slept between ticks, not that an hour was worked.
  return elapsed > maxTick ? 0 : Math.max(0, elapsed);
}
