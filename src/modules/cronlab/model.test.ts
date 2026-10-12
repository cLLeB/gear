import { describe as suite, expect, it } from "vitest";
import { describe, nextRuns, parseCron, PRESETS, runsPerDay, warning, type Cron } from "./model";

const cron = (expr: string): Cron => {
  const r = parseCron(expr);
  if (!r.cron) throw new Error(`${expr}: ${r.error}`);
  return r.cron;
};
const iso = (dates: Date[]) => dates.map((d) => d.toISOString().slice(0, 16).replace("T", " "));
const from = new Date(Date.UTC(2026, 0, 15, 10, 7, 30));

suite("cron model", () => {
  it("parses lists, ranges, steps and names", () => {
    expect(cron("*/15 0-2 1,15 JAN-MAR mon-fri").sets).toEqual([[0, 15, 30, 45], [0, 1, 2], [1, 15], [1, 2, 3], [1, 2, 3, 4, 5]]);
    expect(cron("5/20 * * * 7").sets[0]).toEqual([5, 25, 45]);
    // Sunday may be written 0 or 7.
    expect(cron("0 0 * * 7").sets[4]).toEqual([0]);
    expect(cron("0 0 * * 5-7").sets[4]).toEqual([0, 5, 6]);
    expect(cron("0 0 ? * *").any).toEqual([false, false, true, true, true]);
    expect(cron("10-50/20 * * * *").sets[0]).toEqual([10, 30, 50]);
    expect(cron("@daily").source).toEqual(["0", "0", "*", "*", "*"]);
    expect(cron("  0   12  * * *  ").sets[1]).toEqual([12]);
  });

  it("explains what is wrong", () => {
    const err = (e: string) => {
      const r = parseCron(e);
      return r.cron ? "" : r.error;
    };
    expect(err("")).toMatch(/five fields/);
    expect(err("* * * *")).toMatch(/has 4/);
    expect(err("0 0 * * * *")).toMatch(/sixth field/);
    expect(err("60 * * * *")).toBe("In the minute field: 60 is outside 0–59.");
    expect(err("* 24 * * *")).toMatch(/hour field: 24/);
    expect(err("* * 0 * *")).toMatch(/day of month field/);
    expect(err("* * * 13 *")).toMatch(/month field/);
    expect(err("* * * FOO *")).toMatch(/not a number or a name/);
    expect(err("*/0 * * * *")).toMatch(/step/);
    expect(err("5-1 * * * *")).toMatch(/backwards/);
    expect(err("1,,2 * * * *")).toMatch(/empty item/);
    expect(err("@reboot")).toMatch(/start-up/);
    expect(err("@fortnightly")).toMatch(/Unknown shortcut/);
    const r = parseCron("* * * 13 *");
    expect(r.cron === null && r.field).toBe(3);
  });

  it("finds the next runs", () => {
    expect(iso(nextRuns(cron("*/15 * * * *"), from, 4, true))).toEqual(["2026-01-15 10:15", "2026-01-15 10:30", "2026-01-15 10:45", "2026-01-15 11:00"]);
    expect(iso(nextRuns(cron("0 9 * * 1-5"), from, 3, true))).toEqual(["2026-01-16 09:00", "2026-01-19 09:00", "2026-01-20 09:00"]);
    expect(iso(nextRuns(cron("30 8 1 * *"), from, 2, true))).toEqual(["2026-02-01 08:30", "2026-03-01 08:30"]);
    // The exact minute we are in does not count again.
    expect(iso(nextRuns(cron("7 10 * * *"), from, 1, true))).toEqual(["2026-01-16 10:07"]);
    // 31st: months without one are skipped.
    expect(iso(nextRuns(cron("0 0 31 * *"), from, 3, true))).toEqual(["2026-01-31 00:00", "2026-03-31 00:00", "2026-05-31 00:00"]);
    // Leap day.
    expect(iso(nextRuns(cron("0 0 29 2 *"), from, 2, true))).toEqual(["2028-02-29 00:00", "2032-02-29 00:00"]);
    // Both day fields set: either may match (the 13th, or any Friday).
    expect(iso(nextRuns(cron("0 0 13 * 5"), from, 4, true))).toEqual(["2026-01-16 00:00", "2026-01-23 00:00", "2026-01-30 00:00", "2026-02-06 00:00"]);
    expect(nextRuns(cron("0 0 30 2 *"), from, 3, true)).toEqual([]);
    expect(iso(nextRuns(cron("0 0 1 1 *"), from, 2, true))).toEqual(["2027-01-01 00:00", "2028-01-01 00:00"]);
  });

  it("uses local time unless told otherwise", () => {
    const local = nextRuns(cron("0 12 * * *"), new Date(2026, 5, 1, 0, 0), 1);
    expect([local[0].getHours(), local[0].getMinutes(), local[0].getDate()]).toEqual([12, 0, 1]);
  });

  it("describes schedules in words", () => {
    const say = (e: string) => describe(cron(e));
    expect(say("* * * * *")).toBe("Every minute");
    expect(say("*/5 * * * *")).toBe("Every 5 minutes");
    expect(say("0 * * * *")).toBe("Every hour, on the hour");
    expect(say("15 * * * *")).toBe("Every hour at 15 minutes past");
    expect(say("0 0 * * *")).toBe("At 00:00 every day");
    expect(say("0 9 * * 1-5")).toBe("At 09:00 on weekdays");
    expect(say("30 8 * * MON")).toBe("At 08:30 on Monday");
    expect(say("0 6 1 * *")).toBe("At 06:00 on the 1st");
    expect(say("0 6,18 * * *")).toBe("At 06:00 and 18:00 every day");
    expect(say("*/15 9-17 * * 1-5")).toBe("Every 15 minutes past the hours 09:00 to 17:00 on weekdays");
    expect(say("0 0 1 1,4,7,10 *")).toBe("At 00:00 on the 1st in January, April, July and October");
    expect(say("0 3 * * 0,6")).toBe("At 03:00 at weekends");
    expect(say("0 */2 * * *")).toBe("Every 2 hours");
    expect(say("* 14 * * *")).toBe("Every minute during the 14:00 hour");
    expect(say("0 0 13 * 5")).toBe("At 00:00 on the 13th or on any Friday");
    expect(say("0 12 22,23 * *")).toBe("At 12:00 on the 22nd and 23rd");
    expect(say("5,10 4 * 6-8 *")).toBe("At minutes 5 and 10 past 04:00 every day in June to August");
  });

  it("every preset parses, describes itself and has upcoming runs", () => {
    for (const p of PRESETS) {
      const c = cron(p.expr);
      expect(describe(c).length, p.expr).toBeGreaterThan(5);
      expect(nextRuns(c, from, 3, true), p.expr).toHaveLength(3);
    }
  });

  it("estimates how often a schedule runs and warns about traps", () => {
    expect(runsPerDay(cron("*/5 * * * *"))).toBe(288);
    expect(runsPerDay(cron("0 9 * * 1-5"))).toBeCloseTo(5 / 7);
    expect(runsPerDay(cron("0 0 1 * *"))).toBeCloseTo(1 / 30.44);
    expect(runsPerDay(cron("0 0 * 1 *"))).toBeCloseTo(1 / 12);
    expect(warning(cron("0 0 13 * 5"))).toMatch(/either one/);
    expect(warning(cron("0 0 30 2 *"))).toMatch(/never runs/);
    expect(warning(cron("0 0 31 4,6 *"))).toMatch(/never runs/);
    expect(warning(cron("0 0 31 * *"))).toMatch(/skipped/);
    expect(warning(cron("0 0 1 * *"))).toBeNull();
  });
});
