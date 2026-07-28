import { describe, expect, it } from "vitest";
import { CronParseError, matches, nextRun, nextRuns, parseCron } from "./cron";

const at = (iso: string) => new Date(iso);

describe("parseCron", () => {
  it("parses wildcards, ranges, steps and lists", () => {
    const cron = parseCron("*/15 9-17 1,15 * 1-5");
    expect([...cron.minutes]).toEqual([0, 15, 30, 45]);
    expect([...cron.hours]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...cron.daysOfMonth]).toEqual([1, 15]);
    expect([...cron.daysOfWeek]).toEqual([1, 2, 3, 4, 5]);
  });

  it("normalizes day-of-week 7 to 0", () => {
    expect([...parseCron("0 0 * * 7").daysOfWeek]).toEqual([0]);
  });

  it("rejects malformed expressions", () => {
    expect(() => parseCron("* * * *")).toThrow(CronParseError);
    expect(() => parseCron("99 * * * *")).toThrow(CronParseError);
  });
});

describe("matches", () => {
  it("matches every minute for all-wildcards", () => {
    expect(matches(parseCron("* * * * *"), at("2026-07-18T12:34:00Z"))).toBe(true);
  });

  it("honors the OR rule when both dom and dow are restricted", () => {
    const cron = parseCron("0 0 13 * 5"); // the 13th OR any Friday
    expect(matches(cron, at("2026-02-13T00:00:00Z"))).toBe(true); // Friday the 13th
    expect(matches(cron, at("2026-07-13T00:00:00Z"))).toBe(true); // the 13th (a Monday)
    expect(matches(cron, at("2026-07-10T00:00:00Z"))).toBe(true); // a Friday
    expect(matches(cron, at("2026-07-14T00:00:00Z"))).toBe(false); // neither
  });
});

describe("nextRun", () => {
  it("advances to the next matching minute", () => {
    const cron = parseCron("*/15 * * * *");
    const next = nextRun(cron, at("2026-07-18T12:04:00Z"));
    expect(next?.toISOString()).toBe("2026-07-18T12:15:00.000Z");
  });

  it("finds the next daily midnight", () => {
    const cron = parseCron("0 0 * * *");
    const next = nextRun(cron, at("2026-07-18T12:00:00Z"));
    expect(next?.toISOString()).toBe("2026-07-19T00:00:00.000Z");
  });

  it("finds 9am on the next weekday", () => {
    const cron = parseCron("0 9 * * 1-5");
    // 2026-07-18 is a Saturday -> next weekday 9am is Monday the 20th.
    const next = nextRun(cron, at("2026-07-18T10:00:00Z"));
    expect(next?.toISOString()).toBe("2026-07-20T09:00:00.000Z");
  });

  it("lists several upcoming runs", () => {
    const runs = nextRuns(parseCron("0 0 1 * *"), at("2026-07-18T00:00:00Z"), 3);
    expect(runs.map((d) => d.toISOString())).toEqual([
      "2026-08-01T00:00:00.000Z",
      "2026-09-01T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
    ]);
  });
});
