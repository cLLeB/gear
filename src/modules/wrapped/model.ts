// Gear Wrapped: a playful recap of how you use Gear, in the spirit of a
// year-in-review. Everything here is counted on this machine and never leaves
// it. Commands are kept only as short labels ("git commit", "cargo build"),
// never as full command lines, which can hold paths, hosts or secrets.

import type { Data as TimeData } from "@/modules/timetrack/model";

/** One day of finished commands. */
export interface DayLog {
  /** Commands that finished. */
  n: number;
  /** Of those, how many exited non-zero. */
  fail: number;
  /** Commands per local hour of the day, 0-23. */
  hours: number[];
  /** Commands per label. */
  labels: Record<string, number>;
  /** The longest wait of the day. */
  longest?: { label: string; ms: number };
}

/** Keyed by local date, "2026-01-31". */
export type Log = Record<string, DayLog>;

export const KEEP_DAYS = 400;
const MAX_LABELS_PER_DAY = 200;

// Prefixes that run another program: the interesting name is the next word.
const WRAPPERS = new Set(["sudo", "doas", "time", "nohup", "exec", "env", "command", "builtin", "nice", "npx", "pnpx", "bunx", "&", "call", "start"]);
// Tools whose first argument is the part worth telling apart: "git commit" vs "git push".
const SUBCOMMANDS = new Set([
  "git", "npm", "pnpm", "yarn", "bun", "cargo", "docker", "kubectl", "go", "dotnet", "pip", "pip3", "uv", "poetry", "deno", "gh",
  "terraform", "helm", "az", "gcloud", "aws", "make", "just", "mvn", "gradle", "brew", "winget", "apt", "apt-get", "choco", "scoop",
  "rustup", "nx", "turbo", "flutter", "dart", "mix", "bundle", "rails", "composer", "systemctl", "conda", "podman", "kind", "minikube",
]);
/** Getting around rather than getting things done: left out of the top list, and counted for a fun fact instead. */
export const NAVIGATION = new Set(["cd", "ls", "ll", "la", "dir", "cls", "clear", "exit", "pwd", "history", "z", "pushd", "popd", "set-location", "get-childitem", "sl", "gci"]);

/** The short label a command line is counted under, or null when there is nothing to count. */
export function commandLabel(line: string): string | null {
  // Quoted words stay whole, so "C:\Program Files\Git\git.exe" is one word.
  const words = (line.trim().match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((w) => w.replace(/^["']+|["']+$/g, "")).filter(Boolean);
  let i = 0;
  // Leading VAR=value assignments, then any wrappers and their flags.
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
  while (i < words.length && WRAPPERS.has(words[i].toLowerCase())) {
    i++;
    while (i < words.length && words[i].startsWith("-")) i++;
  }
  if (i >= words.length) return null;
  const program = words[i]
    .split(/[\\/]/)
    .pop()!
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1|sh|com)$/, "");
  if (!/^[a-z0-9][\w.+-]*$/.test(program)) return null;
  const sub = words[i + 1];
  if (SUBCOMMANDS.has(program) && sub && /^[a-z][a-z0-9:_-]*$/.test(sub)) return `${program} ${sub}`;
  return program;
}

const emptyDay = (): DayLog => ({ n: 0, fail: 0, hours: new Array(24).fill(0), labels: {} });

/** Adds one finished command to the log. Returns a new object; the input is not changed. */
export function recordCommand(log: Log, day: string, hour: number, line: string, exitCode: number | null, durationMs: number | null): Log {
  const label = commandLabel(line);
  if (!label) return log;
  const d = log[day] ?? emptyDay();
  let labels = { ...d.labels, [label]: (d.labels[label] ?? 0) + 1 };
  const names = Object.keys(labels);
  if (names.length > MAX_LABELS_PER_DAY) {
    const least = names.reduce((a, b) => (labels[a] <= labels[b] ? a : b));
    const { [least]: _dropped, ...rest } = labels;
    labels = rest;
  }
  const hours = d.hours.slice();
  hours[hour] = (hours[hour] ?? 0) + 1;
  const ms = durationMs ?? 0;
  const longest = ms > (d.longest?.ms ?? 0) ? { label, ms } : d.longest;
  return { ...log, [day]: { n: d.n + 1, fail: d.fail + (exitCode ? 1 : 0), hours, labels, ...(longest ? { longest } : {}) } };
}

/** Drops days older than KEEP_DAYS before `today`. */
export function prune(log: Log, today: string, keep = KEEP_DAYS): Log {
  const cutoff = shift(today, -keep);
  const out: Log = {};
  for (const [day, v] of Object.entries(log)) if (day > cutoff) out[day] = v;
  return out;
}

/** Reads a stored log, ignoring anything malformed. */
export function parseLog(raw: string | null): Log {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object") return {};
    const out: Log = {};
    for (const [day, d] of Object.entries(v as Record<string, DayLog>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !d || typeof d.n !== "number" || !Array.isArray(d.hours) || d.hours.length !== 24) continue;
      out[day] = d;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Counts per label from a shell history file: PowerShell (PSReadLine), bash,
 * zsh (plain or extended ": time:0;cmd") and fish ("- cmd: ...").
 */
export function parseHistory(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (let line of text.split(/\r?\n/)) {
    if (!line.trim() || /^#\d+$/.test(line) || /^\s+(when|paths):/.test(line)) continue;
    line = line.replace(/^: \d+:\d+;/, "").replace(/^- cmd: /, "");
    const label = commandLabel(line);
    if (label) counts[label] = (counts[label] ?? 0) + 1;
  }
  return counts;
}

// ---- dates -------------------------------------------------------------

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shift(day: string, by: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return dateKey(new Date(y, m - 1, d + by));
}

export type RangeId = "month" | "lastMonth" | "year";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** First and last day (inclusive) of a range, and what to call it. */
export function rangeFor(id: RangeId, today: Date): { from: string; to: string; label: string; title: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  if (id === "year") return { from: `${y}-01-01`, to: dateKey(today), label: `${y}`, title: `Your ${y} in Gear` };
  const first = id === "month" ? new Date(y, m, 1) : new Date(y, m - 1, 1);
  const last = id === "month" ? today : new Date(y, m, 0);
  const name = MONTHS[first.getMonth()];
  return { from: dateKey(first), to: dateKey(last), label: name, title: `Your ${name} in Gear` };
}

// ---- the recap ----------------------------------------------------------

export interface Persona {
  title: string;
  emoji: string;
  blurb: string;
}

export interface Summary {
  title: string;
  label: string;
  /** First day of the range, "2026-10-01". */
  from: string;
  commands: number;
  failed: number;
  activeDays: number;
  hours: number[];
  peakHour: number | null;
  /** Most-run labels, navigation left out. */
  top: [string, number][];
  longest: { label: string; ms: number; day: string } | null;
  busiest: { day: string; count: number } | null;
  /** Consecutive days with commands, ending today or yesterday. */
  streak: number;
  /** Times you changed or listed directories. */
  wandering: number;
  commits: number;
  /** From time tracking, when it is on. */
  time: { total: number; languages: [string, number][]; projects: [string, number][] } | null;
  /** All-time counts from the shell's own history file. */
  history: { total: number; top: [string, number][] } | null;
  persona: Persona;
}

const sortDesc = (m: Record<string, number>): [string, number][] => Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

function topWithoutNavigation(counts: Record<string, number>, n: number): [string, number][] {
  return sortDesc(counts)
    .filter(([label]) => !NAVIGATION.has(label.split(" ")[0]))
    .slice(0, n);
}

export function summarize(
  log: Log,
  range: { from: string; to: string; label: string; title: string },
  today: string,
  time: TimeData | null,
  history: Record<string, number> | null,
): Summary {
  const hours = new Array(24).fill(0);
  const labels: Record<string, number> = {};
  let commands = 0;
  let failed = 0;
  let activeDays = 0;
  let longest: Summary["longest"] = null;
  let busiest: Summary["busiest"] = null;
  for (const [day, d] of Object.entries(log)) {
    if (day < range.from || day > range.to || !d.n) continue;
    activeDays++;
    commands += d.n;
    failed += d.fail;
    d.hours.forEach((c, h) => (hours[h] += c));
    for (const [l, c] of Object.entries(d.labels)) labels[l] = (labels[l] ?? 0) + c;
    // A wait under a second is not a wait worth a trophy.
    if (d.longest && d.longest.ms >= 1000 && d.longest.ms > (longest?.ms ?? 0)) longest = { ...d.longest, day };
    if (d.n > (busiest?.count ?? 0)) busiest = { day, count: d.n };
  }
  const peak = hours.reduce((best, c, h) => (c > hours[best] ? h : best), 0);

  let streak = 0;
  for (let day = log[today]?.n ? today : shift(today, -1); log[day]?.n; day = shift(day, -1)) streak++;

  let wandering = 0;
  let commits = 0;
  for (const [l, c] of Object.entries(labels)) {
    if (NAVIGATION.has(l.split(" ")[0])) wandering += c;
    if (l === "git commit") commits += c;
  }

  let timeSummary: Summary["time"] = null;
  if (time) {
    const langs: Record<string, number> = {};
    const projects: Record<string, number> = {};
    let total = 0;
    for (const [day, d] of Object.entries(time)) {
      if (day < range.from || day > range.to) continue;
      total += d.total;
      for (const [k, v] of Object.entries(d.languages)) langs[k] = (langs[k] ?? 0) + v;
      for (const [k, v] of Object.entries(d.projects)) projects[k] = (projects[k] ?? 0) + v;
    }
    if (total > 0) timeSummary = { total, languages: sortDesc(langs).slice(0, 5), projects: sortDesc(projects).slice(0, 3) };
  }

  const historyTotal = history ? Object.values(history).reduce((a, b) => a + b, 0) : 0;
  const historySummary = history && historyTotal ? { total: historyTotal, top: topWithoutNavigation(history, 5) } : null;

  const top = topWithoutNavigation(labels, 5);
  const programs = top.length ? top : (historySummary?.top ?? []);
  return {
    title: range.title,
    label: range.label,
    from: range.from,
    commands,
    failed,
    activeDays,
    hours,
    peakHour: commands ? peak : null,
    top,
    longest,
    busiest,
    streak,
    wandering,
    commits,
    time: timeSummary,
    history: historySummary,
    persona: personaFor(hours, timeSummary?.languages[0]?.[0] ?? null, programs),
  };
}

/** Commands logged before the recap trusts its own top list over the shell history. */
export const ENOUGH_COMMANDS = 50;

/**
 * The commands to celebrate: this period's top list once there is enough of
 * it, otherwise the all-time favourites from the shell history.
 */
export function favorites(s: Summary): { rows: [string, number][]; fromHistory: boolean } {
  if (s.history && (s.commands < ENOUGH_COMMANDS || !s.top.length)) return { rows: s.history.top, fromHistory: true };
  return { rows: s.top, fromHistory: false };
}

// ---- who you are ---------------------------------------------------------

const LANGUAGE_FLAVOR: Record<string, string> = {
  rust: "Rustacean",
  typescript: "TypeScripter",
  typescriptreact: "TypeScripter",
  javascript: "JavaScripter",
  javascriptreact: "JavaScripter",
  python: "Pythonista",
  go: "Gopher",
  java: "Java Brewer",
  kotlin: "Kotliner",
  csharp: "C# Sharpshooter",
  c: "Bit Wrangler",
  cpp: "Bit Wrangler",
  ruby: "Rubyist",
  php: "PHP Artisan",
  swift: "Swift Smith",
  markdown: "Wordsmith",
  html: "Web Weaver",
  css: "Pixel Pusher",
  sql: "Query Crafter",
  shellscript: "Script Slinger",
  powershell: "Script Slinger",
};

const PROGRAM_FLAVOR: Record<string, string> = {
  git: "Committer",
  gh: "Committer",
  cargo: "Rustacean",
  rustc: "Rustacean",
  python: "Pythonista",
  python3: "Pythonista",
  pip: "Pythonista",
  uv: "Pythonista",
  go: "Gopher",
  node: "JavaScripter",
  npm: "Package Juggler",
  pnpm: "Package Juggler",
  yarn: "Package Juggler",
  bun: "Package Juggler",
  docker: "Container Captain",
  podman: "Container Captain",
  kubectl: "Cluster Whisperer",
  helm: "Cluster Whisperer",
  ssh: "Remote Ranger",
  terraform: "Cloud Shaper",
  dotnet: "C# Sharpshooter",
  java: "Java Brewer",
  claude: "AI Wrangler",
  codex: "AI Wrangler",
  gemini: "AI Wrangler",
  vim: "Modal Master",
  nvim: "Modal Master",
};

const ARCHETYPES = [
  { id: "night", hours: [22, 23, 0, 1, 2, 3, 4], name: "Night Owl", emoji: "🦉", blurb: "Your best ideas show up after dark, and so do you." },
  { id: "early", hours: [5, 6, 7, 8], name: "Early Bird", emoji: "🐦", blurb: "Shipping before most people have had coffee." },
  { id: "day", hours: [9, 10, 11, 12, 13, 14, 15, 16], name: "Daylight", emoji: "☀️", blurb: "Steady hours, steady commits. Respect." },
  { id: "evening", hours: [17, 18, 19, 20, 21], name: "Sunset", emoji: "🌇", blurb: "Day job by day, real work by golden hour." },
];

export function personaFor(hours: number[], topLanguage: string | null, programs: [string, number][]): Persona {
  const total = hours.reduce((a, b) => a + b, 0);
  const flavor =
    (topLanguage && LANGUAGE_FLAVOR[topLanguage.toLowerCase()]) ||
    programs.map(([label]) => PROGRAM_FLAVOR[label.split(" ")[0]]).find(Boolean) ||
    "Terminal Tamer";
  if (!total) return { title: `The Fresh-Start ${flavor}`, emoji: "✨", blurb: "Every great streak starts with a first command." };
  const best = ARCHETYPES.map((a) => ({ a, share: a.hours.reduce((s, h) => s + hours[h], 0) / total })).sort((x, y) => y.share - x.share)[0].a;
  return { title: `The ${best.name} ${flavor}`, emoji: best.emoji, blurb: best.blurb };
}

// ---- formatting ------------------------------------------------------------

export function formatHour(h: number): string {
  if (h === 0) return "midnight";
  if (h === 12) return "noon";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

export function formatWait(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
