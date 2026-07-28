// A cron expression parser and scheduler. Anything that runs tasks on a schedule
// needs to answer "when does `0 9 * * 1-5` fire next?" — which means correctly
// parsing the five standard fields (minute, hour, day-of-month, month,
// day-of-week) with their wildcards, ranges, step values (`*/15`), and lists
// (`1,15,30`), and then honoring cron's quirky rule that when *both* day-of-month
// and day-of-week are restricted a date matches if *either* does. Next-run
// computation walks forward minute by minute (bounded), which is simple and
// exactly correct. All times are computed in UTC for determinism.

export interface CronExpression {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

export class CronParseError extends Error {}

interface FieldSpec {
  min: number;
  max: number;
}

const FIELDS: FieldSpec[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 6 }, // day of week (0 = Sunday)
];

/** Parse a standard 5-field cron expression. */
export function parseCron(expression: string): CronExpression {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new CronParseError(`expected 5 fields, got ${parts.length}`);

  const [minutes, hours, daysOfMonth, months, daysOfWeekRaw] = parts.map((p, i) => parseField(p, FIELDS[i]));
  // Normalize day-of-week 7 to 0 (both mean Sunday).
  const daysOfWeek = new Set([...daysOfWeekRaw].map((d) => (d === 7 ? 0 : d)));

  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    domRestricted: parts[2] !== "*",
    dowRestricted: parts[4] !== "*",
  };
}

function parseField(spec: string, field: FieldSpec): Set<number> {
  const values = new Set<number>();
  for (const part of spec.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : parseInt(stepPart, 10);
    if (!Number.isInteger(step) || step < 1) throw new CronParseError(`invalid step "${stepPart}"`);

    let lo: number;
    let hi: number;
    if (rangePart === "*") {
      lo = field.min; hi = field.max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-").map((n) => parseInt(n, 10));
      lo = a; hi = b;
    } else {
      lo = hi = parseInt(rangePart, 10);
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) throw new CronParseError(`invalid field "${part}"`);
    // Day-of-week allows 7 (Sunday) above the nominal max.
    const upper = field.max === 6 ? 7 : field.max;
    if (lo < field.min || hi > upper || lo > hi) throw new CronParseError(`field "${part}" out of range`);

    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

/** Whether a given date matches the cron expression (to the minute, in UTC). */
export function matches(cron: CronExpression, date: Date): boolean {
  if (!cron.minutes.has(date.getUTCMinutes())) return false;
  if (!cron.hours.has(date.getUTCHours())) return false;
  if (!cron.months.has(date.getUTCMonth() + 1)) return false;

  const domOk = cron.daysOfMonth.has(date.getUTCDate());
  const dowOk = cron.daysOfWeek.has(date.getUTCDay());

  if (cron.domRestricted && cron.dowRestricted) return domOk || dowOk;
  if (cron.domRestricted) return domOk;
  if (cron.dowRestricted) return dowOk;
  return true; // both wildcards
}

const MAX_LOOKAHEAD_MINUTES = 366 * 24 * 60 * 4; // ~4 years

/** The next time at or after `after` (exclusive) that the expression fires. */
export function nextRun(cron: CronExpression, after: Date): Date | null {
  const d = new Date(after.getTime());
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() + 1); // strictly after `after`

  for (let i = 0; i < MAX_LOOKAHEAD_MINUTES; i++) {
    if (matches(cron, d)) return new Date(d.getTime());
    d.setUTCMinutes(d.getUTCMinutes() + 1);
  }
  return null;
}

/** The next `count` fire times at or after `after`. */
export function nextRuns(cron: CronExpression, after: Date, count: number): Date[] {
  const out: Date[] = [];
  let cursor = after;
  for (let i = 0; i < count; i++) {
    const next = nextRun(cron, cursor);
    if (!next) break;
    out.push(next);
    cursor = next;
  }
  return out;
}
