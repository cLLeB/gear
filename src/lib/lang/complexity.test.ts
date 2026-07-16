import { describe, expect, it } from "vitest";
import { analyzeComplexity } from "./complexity";

describe("analyzeComplexity", () => {
  it("counts a straight-line function as complexity 1", () => {
    const src = "function f() {\n  return 1;\n}\n";
    const report = analyzeComplexity(src, "javascript");
    expect(report.functions[0]).toMatchObject({ name: "f", complexity: 1 });
  });

  it("adds a decision point per branch", () => {
    const src = "function f(x) {\n  if (x > 0 && x < 10) { return 1; }\n  for (;;) {}\n  return 0;\n}\n";
    const report = analyzeComplexity(src, "javascript");
    // if (1) + && (1) + for (1) + base (1) = 4
    expect(report.functions[0].complexity).toBe(4);
  });

  it("computes file metrics", () => {
    const src = "// a comment\nfunction f() {\n  return 1;\n}\n\n";
    const m = analyzeComplexity(src, "javascript").metrics;
    expect(m.commentLines).toBe(1);
    expect(m.blankLines).toBeGreaterThanOrEqual(1);
    expect(m.sloc).toBeGreaterThan(0);
    expect(m.maxDepth).toBe(1);
  });

  it("measures nesting depth", () => {
    const src = "function f() {\n  if (a) {\n    if (b) {\n      return 1;\n    }\n  }\n}\n";
    expect(analyzeComplexity(src, "javascript").metrics.maxDepth).toBe(3);
  });

  it("handles Python complexity", () => {
    const src = ["def f(x):", "    if x:", "        return 1", "    elif x > 2:", "        return 2", "    return 0", ""].join("\n");
    const report = analyzeComplexity(src, "python");
    expect(report.functions[0].complexity).toBeGreaterThanOrEqual(3);
  });

  it("reports a comment ratio", () => {
    const src = "// one\n// two\ncode();\n";
    const ratio = analyzeComplexity(src, "javascript").metrics.commentRatio;
    expect(ratio).toBeCloseTo(2 / 3, 2);
  });
});
