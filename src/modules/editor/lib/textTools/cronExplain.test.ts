import { describe, expect, it } from "vitest";
import { describeCron, findCron, normalizeCron, upcomingRuns } from "./cronExplain";

describe("describeCron", () => {
  it.each([
    ["30 9 * * 1-5", "At 09:30 on Monday through Friday"],
    ["0 0 * * *", "At 00:00"],
    ["*/15 * * * *", "Every 15 minutes"],
    ["* * * * *", "Every minute"],
    ["0 9,17 * * *", "At 09:00 and 17:00"],
    ["0 */2 * * *", "At minute 0, every 2 hours"],
    ["0 9-17 * * MON-FRI", "At minute 0, between 09:00 and 17:59 on Monday through Friday"],
    ["0 0 1,15 * *", "At 00:00 on days 1 and 15 of the month"],
    ["0 0 1 1 *", "At 00:00 on day 1 of the month in January"],
    ["0 12 1 * 1", "At 12:00 on day 1 of the month or on Monday"],
    ["@hourly", "At minute 0"],
    ["@weekly", "At 00:00 on Sunday"],
  ])("%s", (expr, text) => {
    expect(describeCron(expr)).toBe(text);
  });

  it("throws on invalid expressions", () => {
    expect(() => describeCron("61 * * * *")).toThrow();
    expect(() => describeCron("* * *")).toThrow();
  });
});

describe("helpers", () => {
  it("normalizes names and macros", () => {
    expect(normalizeCron("0 0 * JAN,DEC SUN")).toBe("0 0 * 1,12 0");
    expect(normalizeCron("@daily")).toBe("0 0 * * *");
  });

  it("computes upcoming runs", () => {
    const runs = upcomingRuns("0 9 * * *", 2, new Date(Date.UTC(2026, 0, 1, 10)));
    expect(runs.map((d) => d.toISOString())).toEqual(["2026-01-02T09:00:00.000Z", "2026-01-03T09:00:00.000Z"]);
  });

  it("finds cron expressions in lines", () => {
    expect(findCron("0 5 * * * /usr/bin/backup.sh")).toBe("0 5 * * *");
    expect(findCron("    - cron: '30 2 * * 1'")).toBe("30 2 * * 1");
    expect(findCron('schedule = "@daily"')).toBe("@daily");
    expect(findCron("no cron here")).toBeNull();
  });
});
