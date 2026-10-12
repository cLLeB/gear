import { describe, expect, it } from "vitest";
import { addSample, creditFor, dateKey, formatDuration, lastDays, parseData, prune, streak, summarize, toCsv, type Data, type Sample } from "./model";

const s = (over: Partial<Sample> = {}): Sample => ({ project: "/work/app", language: "typescript", file: "/work/app/a.ts", kind: "editing", ...over });

describe("time tracking model", () => {
  it("adds samples into a day without changing the input", () => {
    const empty: Data = {};
    let d = addSample(empty, "2026-03-01", s(), 30);
    d = addSample(d, "2026-03-01", s({ file: "/work/app/b.rs", language: "rust" }), 60);
    d = addSample(d, "2026-03-01", s({ project: null, language: null, file: null, kind: "terminal" }), 10);
    expect(empty).toEqual({});
    expect(d["2026-03-01"]).toEqual({
      total: 100,
      projects: { "/work/app": 90 },
      languages: { typescript: 30, rust: 60 },
      files: { "/work/app/a.ts": 30, "/work/app/b.rs": 60 },
      kinds: { editing: 90, terminal: 10 },
    });
    expect(addSample(d, "2026-03-01", s(), 0)).toBe(d);
  });

  it("caps the files kept per day", () => {
    let d: Data = {};
    for (let i = 0; i < 320; i++) d = addSample(d, "2026-03-01", s({ file: `/f${i}` }), i + 1);
    expect(Object.keys(d["2026-03-01"].files)).toHaveLength(300);
    expect(d["2026-03-01"].files["/f0"]).toBeUndefined();
    expect(d["2026-03-01"].files["/f319"]).toBe(320);
  });

  it("lists days, prunes old ones and counts a streak", () => {
    expect(lastDays("2026-03-02", 3)).toEqual(["2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(dateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    let d: Data = {};
    for (const day of ["2025-01-01", "2026-02-27", "2026-02-28", "2026-03-01"]) d = addSample(d, day, s(), 60);
    expect(Object.keys(prune(d, "2026-03-02"))).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
    // Today has nothing yet: the run up to yesterday still counts.
    expect(streak(d, "2026-03-02")).toBe(3);
    expect(streak(d, "2026-03-01")).toBe(3);
    expect(streak(d, "2026-03-03")).toBe(0);
    expect(streak({}, "2026-03-03")).toBe(0);
  });

  it("summarises a range", () => {
    let d: Data = {};
    d = addSample(d, "2026-03-01", s(), 3600);
    d = addSample(d, "2026-03-02", s({ project: "/work/lib", language: "rust", file: "/work/lib/x.rs" }), 1800);
    d = addSample(d, "2026-03-02", s({ kind: "terminal", file: null, language: null }), 600);
    const sum = summarize(d, lastDays("2026-03-03", 3));
    expect(sum.total).toBe(6000);
    expect(sum.activeDays).toBe(2);
    expect(sum.days.map((x) => x.total)).toEqual([3600, 2400, 0]);
    expect(sum.projects).toEqual([["/work/app", 4200], ["/work/lib", 1800]]);
    expect(sum.languages[0]).toEqual(["typescript", 3600]);
    expect(sum.kinds).toEqual([["editing", 5400], ["terminal", 600]]);
  });

  it("formats durations and exports CSV", () => {
    expect([5, 59, 60, 3599, 3600, 5400].map(formatDuration)).toEqual(["5s", "59s", "1m", "59m", "1h 00m", "1h 30m"]);
    let d = addSample({}, "2026-03-01", s({ project: 'C:\\my, "odd" dir' }), 1800);
    d = addSample(d, "2026-03-01", s({ project: null }), 900);
    expect(toCsv(d, ["2026-02-28", "2026-03-01"])).toBe('date,project,seconds,hours\n2026-03-01,"C:\\my, ""odd"" dir",1800,0.50\n2026-03-01,(no folder),900,0.25\n');
  });

  it("reads stored data defensively", () => {
    expect(parseData(null)).toEqual({});
    expect(parseData("[1]")).toEqual({});
    expect(parseData("{bad")).toEqual({});
    expect(parseData('{"2026-03-01":{"total":5},"junk":{"total":1},"2026-03-02":{"total":"x"}}')).toEqual({ "2026-03-01": { total: 5, projects: {}, languages: {}, files: {}, kinds: {} } });
  });

  it("credits a tick only for real, recent, foreground activity", () => {
    expect(creditFor(30, 10, true)).toBe(30);
    expect(creditFor(30, 10, false)).toBe(0);
    expect(creditFor(30, 121, true)).toBe(0);
    // The laptop slept for an hour between two ticks.
    expect(creditFor(3600, 5, true)).toBe(0);
    expect(creditFor(-5, 5, true)).toBe(0);
  });
});
