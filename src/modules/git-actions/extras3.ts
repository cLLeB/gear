// Pure helpers for the third set of git workflows.

export interface Owner {
  author: string;
  lines: number;
  share: number;
  lastTime: number;
}

/** `git blame --line-porcelain` → lines per author (by share). */
export function parseOwnership(out: string): Owner[] {
  const map = new Map<string, { lines: number; last: number }>();
  let author = "";
  let total = 0;
  for (const l of out.split("\n")) {
    if (l.startsWith("author ")) author = l.slice(7);
    else if (l.startsWith("author-time ")) {
      const t = Number(l.slice(12)) * 1000;
      const e = map.get(author) ?? { lines: 0, last: 0 };
      e.lines++;
      e.last = Math.max(e.last, t);
      map.set(author, e);
      total++;
    }
  }
  return [...map.entries()]
    .map(([a, e]) => ({ author: a, lines: e.lines, share: total ? e.lines / total : 0, lastTime: e.last }))
    .sort((x, y) => y.lines - x.lines);
}

export interface Activity {
  commits: number;
  added: number;
  removed: number;
  files: number;
  byDay: Map<string, number>;
  topFiles: [string, number][];
}

/** `git log --numstat --format=@%ad --date=short` → totals. */
export function parseActivity(out: string): Activity {
  let commits = 0;
  let added = 0;
  let removed = 0;
  let day = "";
  const byDay = new Map<string, number>();
  const files = new Map<string, number>();
  for (const l of out.split("\n")) {
    const d = /^@(\d{4}-\d\d-\d\d)/.exec(l);
    if (d) {
      commits++;
      day = d[1];
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
      continue;
    }
    const n = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(l);
    if (n) {
      const a = n[1] === "-" ? 0 : Number(n[1]);
      const r = n[2] === "-" ? 0 : Number(n[2]);
      added += a;
      removed += r;
      files.set(n[3], (files.get(n[3]) ?? 0) + a + r);
    }
  }
  return { commits, added, removed, files: files.size, byDay, topFiles: [...files.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10) };
}

/** Tiny bar chart for a commits-per-day map over the last `days` days. */
export function sparkline(byDay: Map<string, number>, days: number, today = new Date()): string {
  const bars = "▁▂▃▄▅▆▇█";
  const vals: number[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    vals.push(byDay.get(d.toISOString().slice(0, 10)) ?? 0);
  }
  const max = Math.max(1, ...vals);
  return vals.map((v) => (v === 0 ? "·" : bars[Math.min(7, Math.ceil((v / max) * 7))])).join("");
}

/** Branch names that git would reject. */
export function branchNameProblem(name: string): string | null {
  if (!name.trim()) return "empty";
  if (/\s/.test(name)) return "contains spaces";
  if (/\.\.|[~^:?*[\\]|@\{|\/\/|\/$|^\/|\.lock$|^-|\.$/.test(name)) return "contains characters git doesn't allow";
  return null;
}
