// Cron expressions (the five-field kind used by crontab, GitHub Actions,
// Kubernetes): parsing with clear errors, the next run times, and a
// description in plain words.

export interface FieldSpec {
  name: string;
  min: number;
  max: number;
  names?: string[];
}

export const FIELDS: FieldSpec[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, names: ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] },
  { name: "day of week", min: 0, max: 7, names: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] },
];

const MACROS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

export interface Cron {
  /** Allowed values per field, sorted; day of week is 0–6 with Sunday as 0. */
  sets: number[][];
  /** True where the field was written as `*` (or `?`). */
  any: boolean[];
  /** The five fields as written (after expanding a macro). */
  source: string[];
}

export type ParseResult = { cron: Cron; error: null } | { cron: null; error: string; field: number | null };

function parseValue(token: string, spec: FieldSpec, index: number): number | string {
  const upper = token.toUpperCase();
  if (spec.names) {
    const at = spec.names.indexOf(upper);
    if (at >= 0) return at + (index === 3 ? 1 : 0);
  }
  if (!/^\d+$/.test(token)) return `"${token}" is not a number${spec.names ? " or a name" : ""}`;
  const n = Number(token);
  if (n < spec.min || n > spec.max) return `${n} is outside ${spec.min}–${spec.max}`;
  return n;
}

function parseField(text: string, spec: FieldSpec, index: number): number[] | string {
  const out = new Set<number>();
  for (const part of text.split(",")) {
    if (part === "") return "there is an empty item in the list";
    const [range, stepText, extra] = part.split("/");
    if (extra !== undefined) return `"${part}" has more than one /`;
    let step = 1;
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText) || Number(stepText) < 1) return `the step "${stepText}" must be a whole number above 0`;
      step = Number(stepText);
    }
    let lo: number;
    let hi: number;
    if (range === "*" || range === "?") {
      lo = spec.min;
      hi = index === 4 ? 6 : spec.max;
    } else if (range.includes("-")) {
      const [a, b, more] = range.split("-");
      if (more !== undefined) return `"${range}" is not a range`;
      const x = parseValue(a, spec, index);
      const y = parseValue(b, spec, index);
      if (typeof x === "string") return x;
      if (typeof y === "string") return y;
      if (x > y) return `the range ${range} runs backwards`;
      lo = x;
      hi = y;
    } else {
      const x = parseValue(range, spec, index);
      if (typeof x === "string") return x;
      lo = x;
      // "5/15" means "from 5, every 15".
      hi = stepText !== undefined ? (index === 4 ? 6 : spec.max) : x;
    }
    for (let v = lo; v <= hi; v += step) out.add(index === 4 && v === 7 ? 0 : v);
  }
  return [...out].sort((a, b) => a - b);
}

export function parseCron(input: string): ParseResult {
  const text = input.trim();
  if (!text) return { cron: null, error: "Enter five fields: minute hour day-of-month month day-of-week", field: null };
  if (text.startsWith("@")) {
    const macro = MACROS[text.toLowerCase()];
    if (!macro) return { cron: null, error: text.toLowerCase() === "@reboot" ? "@reboot runs once at start-up; it has no schedule to show." : `Unknown shortcut ${text}. Known: ${Object.keys(MACROS).join(", ")}`, field: null };
    return parseCron(macro);
  }
  const parts = text.split(/\s+/);
  if (parts.length !== 5) return { cron: null, error: `A cron expression has 5 fields; this one has ${parts.length}.${parts.length === 6 ? " (A sixth field for seconds or the year is not part of standard cron.)" : ""}`, field: null };
  const sets: number[][] = [];
  for (const [i, part] of parts.entries()) {
    const r = parseField(part, FIELDS[i], i);
    if (typeof r === "string") return { cron: null, error: `In the ${FIELDS[i].name} field: ${r}.`, field: i };
    sets.push(r);
  }
  return { cron: { sets, any: parts.map((p) => p === "*" || p === "?"), source: parts }, error: null };
}

function dayMatches(c: Cron, dom: number, dow: number): boolean {
  const domOk = c.sets[2].includes(dom);
  const dowOk = c.sets[4].includes(dow);
  // Classic cron: when both day fields are restricted, either one matching is enough.
  if (!c.any[2] && !c.any[4]) return domOk || dowOk;
  return domOk && dowOk;
}

/** The next `count` times the schedule fires after `from`, in local time or UTC. */
export function nextRuns(c: Cron, from: Date, count: number, utc = false): Date[] {
  const get = utc
    ? { y: (d: Date) => d.getUTCFullYear(), mo: (d: Date) => d.getUTCMonth(), d: (d: Date) => d.getUTCDate(), h: (d: Date) => d.getUTCHours(), mi: (d: Date) => d.getUTCMinutes(), dow: (d: Date) => d.getUTCDay() }
    : { y: (d: Date) => d.getFullYear(), mo: (d: Date) => d.getMonth(), d: (d: Date) => d.getDate(), h: (d: Date) => d.getHours(), mi: (d: Date) => d.getMinutes(), dow: (d: Date) => d.getDay() };
  const make = (y: number, mo: number, d: number, h: number, mi: number) => (utc ? new Date(Date.UTC(y, mo, d, h, mi)) : new Date(y, mo, d, h, mi));
  const out: Date[] = [];
  let t = make(get.y(from), get.mo(from), get.d(from), get.h(from), get.mi(from) + 1);
  const limit = get.y(from) + 12;
  // Each step jumps to the start of the next month, day, hour or minute that could match.
  for (let guard = 0; out.length < count && guard < 200000 && get.y(t) <= limit; guard++) {
    if (!c.sets[3].includes(get.mo(t) + 1)) t = make(get.y(t), get.mo(t) + 1, 1, 0, 0);
    else if (!dayMatches(c, get.d(t), get.dow(t))) t = make(get.y(t), get.mo(t), get.d(t) + 1, 0, 0);
    else if (!c.sets[1].includes(get.h(t))) t = make(get.y(t), get.mo(t), get.d(t), get.h(t) + 1, 0);
    else if (!c.sets[0].includes(get.mi(t))) t = make(get.y(t), get.mo(t), get.d(t), get.h(t), get.mi(t) + 1);
    else {
      out.push(t);
      t = make(get.y(t), get.mo(t), get.d(t), get.h(t), get.mi(t) + 1);
    }
  }
  return out;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function ordinal(n: number): string {
  const s = n % 100;
  const suffix = s >= 11 && s <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** Consecutive runs become "a to b"; everything else is listed. */
function ranges(values: number[], name: (n: number) => string): string {
  const parts: string[] = [];
  for (let i = 0; i < values.length; ) {
    let j = i;
    while (j + 1 < values.length && values[j + 1] === values[j] + 1) j++;
    parts.push(j - i >= 2 ? `${name(values[i])} to ${name(values[j])}` : values.slice(i, j + 1).map(name).join(" and "));
    i = j + 1;
  }
  return list(parts);
}

const stepOf = (source: string): number | null => (/^\*\/(\d+)$/.exec(source) ? Number(/^\*\/(\d+)$/.exec(source)?.[1]) : null);
const pad = (n: number) => String(n).padStart(2, "0");

/** The schedule in plain words. */
export function describe(c: Cron): string {
  const [min, hour, dom, month, dow] = c.sets;
  const minStep = stepOf(c.source[0]);
  const hourStep = stepOf(c.source[1]);
  let time: string;
  if (c.any[0] && c.any[1]) time = "Every minute";
  else if (minStep && c.any[1]) time = `Every ${minStep} minutes`;
  else if (c.any[0]) time = `Every minute during ${hour.length === 1 ? `the ${pad(hour[0])}:00 hour` : `the hours ${ranges(hour, (h) => `${pad(h)}:00`)}`}`;
  else if (min.length === 1 && hour.length === 1) time = `At ${pad(hour[0])}:${pad(min[0])}`;
  else if (min.length === 1 && c.any[1]) time = min[0] === 0 ? "Every hour, on the hour" : `Every hour at ${min[0]} minutes past`;
  else if (min.length === 1 && hourStep) time = `Every ${hourStep} hours${min[0] ? ` at ${min[0]} minutes past` : ""}`;
  else if (min.length === 1) time = `At ${list(hour.map((h) => `${pad(h)}:${pad(min[0])}`))}`;
  else {
    const mins = minStep ? `every ${minStep} minutes` : `at minutes ${ranges(min, String)}`;
    time = c.any[1] ? mins.charAt(0).toUpperCase() + mins.slice(1) : `${mins.charAt(0).toUpperCase() + mins.slice(1)} past ${hour.length === 1 ? `${pad(hour[0])}:00` : `the hours ${ranges(hour, (h) => `${pad(h)}:00`)}`}`;
  }
  const dayParts: string[] = [];
  if (!c.any[2]) dayParts.push(`on the ${ranges(dom, ordinal)}`);
  if (!c.any[4]) dayParts.push(dow.join() === "1,2,3,4,5" ? "on weekdays" : dow.join() === "0,6" ? "at weekends" : `on ${ranges(dow, (d) => DAYS[d])}`);
  const days = dayParts.length === 2 ? `${dayParts[0]} or ${dayParts[1].replace(/^on /, "on any ")}` : (dayParts[0] ?? (time.startsWith("At") ? "every day" : ""));
  const months = c.any[3] ? "" : `in ${ranges(month, (m) => MONTHS[m - 1])}`;
  return [time, days, months].filter(Boolean).join(" ").replace(/\s+/g, " ");
}

export const PRESETS: { label: string; expr: string }[] = [
  { label: "Every 5 minutes", expr: "*/5 * * * *" },
  { label: "Every hour", expr: "0 * * * *" },
  { label: "Every day at midnight", expr: "0 0 * * *" },
  { label: "Weekdays at 09:00", expr: "0 9 * * 1-5" },
  { label: "Every Monday at 08:30", expr: "30 8 * * MON" },
  { label: "First day of the month at 06:00", expr: "0 6 1 * *" },
  { label: "Every 15 minutes during working hours on weekdays", expr: "*/15 9-17 * * 1-5" },
  { label: "Twice a day (06:00 and 18:00)", expr: "0 6,18 * * *" },
  { label: "Every quarter (1 Jan, Apr, Jul, Oct)", expr: "0 0 1 1,4,7,10 *" },
  { label: "Sundays at 03:00", expr: "0 3 * * 0" },
];

/** Average runs per day, for a sense of how busy a schedule is. */
export function runsPerDay(c: Cron): number {
  const perDay = c.sets[0].length * c.sets[1].length;
  const monthShare = c.sets[3].length / 12;
  let dayShare: number;
  if (c.any[2] && c.any[4]) dayShare = 1;
  else if (c.any[2]) dayShare = c.sets[4].length / 7;
  else if (c.any[4]) dayShare = Math.min(1, c.sets[2].length / 30.44);
  else dayShare = Math.min(1, c.sets[4].length / 7 + c.sets[2].length / 30.44);
  return perDay * dayShare * monthShare;
}

/** A warning about a schedule that is valid but probably not what was meant. */
export function warning(c: Cron): string | null {
  if (!c.any[2] && !c.any[4]) return "Both day fields are set: cron runs when either one matches, not only when both do.";
  const shortMonths = c.sets[3].filter((m) => [4, 6, 9, 11].includes(m));
  if (!c.any[2] && c.sets[2].every((d) => d > 29) && c.sets[3].join() === "2") return "February never has that day, so this never runs.";
  if (!c.any[2] && c.sets[2].every((d) => d === 31) && shortMonths.length === c.sets[3].length) return "None of these months has a 31st, so this never runs.";
  if (!c.any[2] && c.sets[2].some((d) => d >= 29)) return "Months without that day are skipped.";
  return null;
}
