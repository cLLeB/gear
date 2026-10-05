import { describe, expect, it } from "vitest";
import { branchNameProblem, parseActivity, parseOwnership, sparkline } from "./extras3";

describe("ownership", () => {
  it("counts lines per author", () => {
    const out = ["abc 1 1 1", "author Ada", "author-time 100", "\tline", "def 2 2 1", "author Bob", "author-time 200", "\tline", "abc 3 3", "author Ada", "author-time 300", "\tline"].join("\n");
    expect(parseOwnership(out)).toEqual([
      { author: "Ada", lines: 2, share: 2 / 3, lastTime: 300_000 },
      { author: "Bob", lines: 1, share: 1 / 3, lastTime: 200_000 },
    ]);
  });
});

describe("activity", () => {
  it("totals numstat output", () => {
    const a = parseActivity("@2024-05-01\n\n10\t2\tsrc/a.ts\n-\t-\timg.png\n@2024-05-02\n\n1\t1\tsrc/a.ts\n");
    expect(a).toMatchObject({ commits: 2, added: 11, removed: 3, files: 2 });
    expect(a.topFiles[0]).toEqual(["src/a.ts", 14]);
    expect(sparkline(a.byDay, 3, new Date("2024-05-03T12:00:00Z"))).toBe("██·");
  });
});

describe("branch names", () => {
  it("rejects invalid names", () => {
    expect(branchNameProblem("feat/login")).toBeNull();
    expect(branchNameProblem("has space")).toMatch(/spaces/);
    expect(branchNameProblem("a..b")).toBeTruthy();
    expect(branchNameProblem("x.lock")).toBeTruthy();
  });
});
