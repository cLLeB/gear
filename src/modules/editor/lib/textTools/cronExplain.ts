// Explain a cron expression in plain English (crontab.guru, in the editor)
// and list its next runs. Accepts the 5-field form plus month/day names
// (JAN, MON-FRI) and the @yearly/@monthly/@weekly/@daily/@hourly macros.

import { nextRuns, parseCron } from "@/lib/lang/cron";

const MACROS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Expand macros and names into the plain numeric 5-field form. */
export function normalizeCron(expr: string): string {
  const t = expr.trim();
  if (MACROS[t.toLowerCase()]) return MACROS[t.toLowerCase()];
  const parts = t.split(/\s+/);
  if (parts.length !== 5) return t;
  parts[3] = parts[3].replace(/[A-Za-z]{3}/g, (m) => {
    const i = MONTHS.indexOf(m.toUpperCase());
    return i === -1 ? m : String(i + 1);
  });
  parts[4] = parts[4].replace(/[A-Za-z]{3}/g, (m) => {
    const i = DAYS.indexOf(m.toUpperCase());
    return i === -1 ? m : String(i);
  });
  return parts.join(" ");
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const pad = (n: number | string) => String(n).padStart(2, "0");

function describeValues(field: string, unit: string, name: (n: number) => string): string | null {
  if (field === "*") return null;
  const step = /^\*\/(\d+)$/.exec(field);
  if (step) return `every ${step[1]} ${unit}s`;
  const parts = field.split(",").map((p) => {
    const r = /^(\d+)-(\d+)(?:\/(\d+))?$/.exec(p);
    if (r) return r[3] ? `every ${r[3]} ${unit}s from ${name(+r[1])} through ${name(+r[2])}` : `${name(+r[1])} through ${name(+r[2])}`;
    const s = /^(\d+)\/(\d+)$/.exec(p);
    if (s) return `every ${s[2]} ${unit}s starting at ${name(+s[1])}`;
    return name(+p);
  });
  return list(parts);
}

export function describeCron(expression: string): string {
  const norm = normalizeCron(expression);
  parseCron(norm); // validate; throws CronParseError
  const [min, hour, dom, month, dow] = norm.split(/\s+/);

  let time: string;
  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) time = `At ${pad(hour)}:${pad(min)}`;
  else if (/^\d+$/.test(min) && /^[\d,]+$/.test(hour)) time = `At ${list(hour.split(",").map((h) => `${pad(h)}:${pad(min)}`))}`;
  else {
    const m =
      min === "*"
        ? "Every minute"
        : /^\d+$/.test(min)
          ? `At minute ${min}`
          : /^\*\/\d+$/.test(min)
            ? `Every ${min.slice(2)} minutes`
            : `At minutes ${describeValues(min, "minute", String)} past the hour`;
    const h = describeValues(hour, "hour", (n) => `${pad(n)}:00`);
    time = h ? `${m}, ${/^every/.test(h) ? h : `between ${h.replace(/(\d\d):00 through (\d\d):00/, "$1:00 and $2:59")}`}` : m;
    if (min === "*" && hour !== "*" && /^\d+$/.test(hour)) time = `Every minute from ${pad(hour)}:00 to ${pad(hour)}:59`;
  }

  const days: string[] = [];
  const domText = describeValues(dom, "day", String);
  const dowText = describeValues(dow, "day", (n) => DAY_NAMES[n]);
  if (domText && dowText) days.push(`on day ${domText} of the month or on ${dowText}`);
  else if (domText) days.push(`on day${/,| and /.test(domText) ? "s" : ""} ${domText} of the month`);
  else if (dowText) days.push(`on ${dowText}`);
  const monthText = describeValues(month, "month", (n) => MONTH_NAMES[n - 1]);
  if (monthText) days.push(`in ${monthText}`);
  return [time, ...days].join(" ");
}

export function upcomingRuns(expression: string, count = 5, from = new Date()): Date[] {
  return nextRuns(parseCron(normalizeCron(expression)), from, count);
}

/** A cron expression on a line: 5 fields at the start (crontab lines) or quoted. */
export function findCron(line: string): string | null {
  const macro = /@(yearly|annually|monthly|weekly|daily|midnight|hourly)\b/i.exec(line);
  if (macro) return macro[0];
  const quoted = /["'`]((?:[\d*,/A-Za-z-]+\s+){4}[\d*,/A-Za-z-]+)["'`]/.exec(line);
  if (quoted) return quoted[1];
  const bare = /^\s*((?:[\d*,/A-Za-z-]+\s+){4}[\d*,/A-Za-z-]+)/.exec(line);
  return bare ? bare[1] : null;
}
