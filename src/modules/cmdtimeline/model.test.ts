import { describe, expect, it } from "vitest";
import { axisTicks, busyTime, commandKey, filterEntries, formatMs, lanesOf, summarize, type TimelineEntry } from "./model";

let nextId = 1;
const entry = (leafId: number, command: string, startedAt: number, finishedAt: number, exitCode: number | null = 0, cwd: string | null = "/repo"): TimelineEntry => ({
  id: nextId++,
  leafId,
  command,
  startedAt,
  finishedAt,
  exitCode,
  cwd,
});

describe("commandKey", () => {
  it("groups by program and first non-flag argument", () => {
    expect(commandKey("npm test -- --watch")).toBe("npm test");
    expect(commandKey("git status")).toBe("git status");
    expect(commandKey("ls -la")).toBe("ls");
    expect(commandKey("  cargo   build --release")).toBe("cargo build");
  });

  it("drops env assignments, paths and Windows extensions", () => {
    expect(commandKey("CI=1 NODE_ENV=test npm run lint")).toBe("npm run");
    expect(commandKey("C:\\tools\\node.exe script.js")).toBe("node script.js");
    expect(commandKey("./scripts/build.sh")).toBe("build.sh");
  });

  it("looks past package runners", () => {
    expect(commandKey("npx vitest run src")).toBe("vitest run");
    expect(commandKey("npx tsc --noEmit")).toBe("tsc");
    expect(commandKey("npx")).toBe("npx");
  });
});

describe("filterEntries", () => {
  const all = [entry(1, "npm test", 0, 100, 1), entry(1, "git status", 200, 210), entry(2, "npm run build", 500, 900, 0, "/other")];

  it("keeps entries overlapping the window", () => {
    expect(filterEntries(all, { from: 150, to: 600 }).map((e) => e.command)).toEqual(["git status", "npm run build"]);
  });

  it("filters by text in the command or folder, and by failures", () => {
    expect(filterEntries(all, { from: 0, to: 1000 }, { query: "NPM" })).toHaveLength(2);
    expect(filterEntries(all, { from: 0, to: 1000 }, { query: "other" })).toHaveLength(1);
    expect(filterEntries(all, { from: 0, to: 1000 }, { failedOnly: true }).map((e) => e.command)).toEqual(["npm test"]);
  });
});

describe("lanesOf", () => {
  it("orders panes by their first command", () => {
    expect(lanesOf([entry(7, "b", 50, 60), entry(3, "a", 10, 20), entry(7, "c", 5, 6)])).toEqual([7, 3]);
  });
});

describe("busyTime", () => {
  it("counts overlapping commands once", () => {
    expect(busyTime([entry(1, "a", 0, 100), entry(2, "b", 50, 150), entry(1, "c", 300, 310)])).toBe(160);
  });

  it("handles nested and empty input", () => {
    expect(busyTime([entry(1, "a", 0, 100), entry(2, "b", 10, 20)])).toBe(100);
    expect(busyTime([])).toBe(0);
  });
});

describe("summarize", () => {
  it("counts failures, finds the slowest, and groups runs", () => {
    const s = summarize([
      entry(1, "npm test", 0, 4000, 1),
      entry(1, "npm test -- -u", 5000, 7000, 0),
      entry(2, "cargo build", 0, 9000, 0),
      entry(2, "ls", 9500, 9510, 0),
    ]);
    expect(s.count).toBe(4);
    expect(s.failures).toBe(1);
    expect(s.slowest[0].command).toBe("cargo build");
    const npm = s.groups.find((g) => g.key === "npm test");
    expect(npm).toMatchObject({ runs: 2, failures: 1, totalMs: 6000, avgMs: 3000, maxMs: 4000, lastExitCode: 0 });
    expect(s.groups[0].key).toBe("cargo build");
  });
});

describe("axisTicks", () => {
  it("picks round steps that fit", () => {
    const ticks = axisTicks({ from: 0, to: 60_000 }, 8);
    expect(ticks).toEqual([0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000]);
    expect(axisTicks({ from: 0, to: 3_600_000 }, 8).length).toBeLessThanOrEqual(8);
  });
});

describe("formatMs", () => {
  it("formats short and long durations", () => {
    expect(formatMs(250)).toBe("250ms");
    expect(formatMs(3200)).toBe("3.2s");
    expect(formatMs(42_000)).toBe("42s");
    expect(formatMs(125_000)).toBe("2m 5s");
    expect(formatMs(3_780_000)).toBe("1h 3m");
  });
});
