import { describe, expect, it } from "vitest";
import { calculate, formatResult, normalizeExpression, sumNumbers } from "./calc";

describe("calculate", () => {
  it.each([
    ["1 + 2 * 3", "7"],
    ["2^10", "1024"],
    ["1,234.5 * 2", "2469"],
    ["0.1 + 0.2", "0.3"],
    ["15% of 80", "12"],
    ["80 + 15%", "92"],
    ["200 - 10%", "180"],
    ["10 × 3 ÷ 4", "7.5"],
    ["sqrt(16) + abs(-2)", "6"],
    ["2 * pi", String(formatResult(2 * Math.PI))],
    ["7 > 3", "true"],
    ["4 + 4 =", "8"],
  ])("%s = %s", (expr, result) => {
    expect(calculate(expr)).toBe(result);
  });

  it("throws on invalid input", () => {
    expect(() => calculate("2 +")).toThrow();
    expect(() => calculate("foo(1)")).toThrow();
  });
});

describe("helpers", () => {
  it("normalizes symbols", () => {
    expect(normalizeExpression("3 x 4")).toBe("3 * 4");
  });
  it("formats without float noise", () => {
    expect(formatResult(1 / 3)).toBe("0.333333333333");
    expect(formatResult(1e-9)).toBe("1e-9");
  });
  it("sums numbers across selections", () => {
    expect(sumNumbers(["a 1,000 b", "2.5", "-0.5 and 1"])).toEqual({ sum: 1003, count: 4 });
  });
});
