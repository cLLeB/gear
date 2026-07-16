import { describe, expect, it } from "vitest";
import { computeFoldRanges } from "./foldRanges";

const has = (ranges: ReturnType<typeof computeFoldRanges>, start: number, end: number, kind?: string) =>
  ranges.some((r) => r.startLine === start && r.endLine === end && (!kind || r.kind === kind));

describe("computeFoldRanges", () => {
  it("folds brace blocks", () => {
    const src = "function f() {\n  return 1;\n}\n";
    expect(has(computeFoldRanges(src, "javascript"), 1, 3, "block")).toBe(true);
  });

  it("folds nested braces separately", () => {
    const src = "function f() {\n  if (x) {\n    y();\n  }\n}\n";
    const ranges = computeFoldRanges(src, "javascript");
    expect(has(ranges, 1, 5)).toBe(true);
    expect(has(ranges, 2, 4)).toBe(true);
  });

  it("folds runs of line comments", () => {
    const src = "// one\n// two\n// three\ncode();\n";
    expect(has(computeFoldRanges(src, "javascript"), 1, 3, "comment")).toBe(true);
  });

  it("folds multi-line block comments", () => {
    const src = "/*\n a\n b\n*/\ncode();\n";
    expect(computeFoldRanges(src, "javascript").some((r) => r.kind === "comment")).toBe(true);
  });

  it("folds #region markers", () => {
    const src = "// #region setup\nconst a = 1;\nconst b = 2;\n// #endregion\n";
    expect(computeFoldRanges(src, "javascript").some((r) => r.kind === "region")).toBe(true);
  });

  it("folds Python indentation blocks", () => {
    const src = ["def f():", "    a = 1", "    b = 2", "c = 3", ""].join("\n");
    expect(has(computeFoldRanges(src, "python"), 1, 3, "block")).toBe(true);
  });

  it("ignores single-line blocks", () => {
    expect(computeFoldRanges("f() {}\n", "javascript")).toHaveLength(0);
  });
});
