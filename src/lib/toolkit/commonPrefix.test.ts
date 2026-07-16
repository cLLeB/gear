import { describe, expect, it } from "vitest";
import { commonPathPrefix, longestCommonPrefix } from "./commonPrefix";

describe("longestCommonPrefix", () => {
  it("finds a shared prefix", () => {
    expect(longestCommonPrefix(["flower", "flow", "flight"])).toBe("fl");
  });

  it("returns empty when none shared", () => {
    expect(longestCommonPrefix(["dog", "cat"])).toBe("");
  });
});

describe("commonPathPrefix", () => {
  it("finds a shared directory", () => {
    expect(commonPathPrefix(["src/a/b.ts", "src/a/c.ts", "src/a/d/e.ts"])).toBe("src/a");
  });

  it("normalises backslashes", () => {
    expect(commonPathPrefix(["a\\b\\c", "a/b/d"])).toBe("a/b");
  });

  it("handles no overlap", () => {
    expect(commonPathPrefix(["a/x", "b/y"])).toBe("");
  });
});
