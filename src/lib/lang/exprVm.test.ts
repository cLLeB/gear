import { describe, expect, it } from "vitest";
import { compile, runExpression } from "./exprVm";
import { evaluateExpression, parseExpression } from "./expression";

describe("stack VM execution", () => {
  it("evaluates arithmetic with precedence", () => {
    expect(runExpression("2 + 3 * 4")).toBe(14);
    expect(runExpression("(2 + 3) * 4")).toBe(20);
    expect(runExpression("2 ** 3 ** 2")).toBe(512); // right-associative
  });

  it("evaluates comparisons and returns booleans", () => {
    expect(runExpression("5 > 3")).toBe(true);
    expect(runExpression("5 == 6")).toBe(false);
  });

  it("evaluates builtin function calls", () => {
    expect(runExpression("max(2, 8, 5)")).toBe(8);
    expect(runExpression("abs(-4) + 1")).toBe(5);
  });

  it("loads variables from scope", () => {
    expect(runExpression("x * y + 1", { variables: { x: 3, y: 4 } })).toBe(13);
  });

  it("short-circuits && without evaluating the dead branch", () => {
    // `missing` would throw if evaluated; short-circuit must skip it.
    expect(runExpression("false && missing")).toBe(false);
    expect(runExpression("true || missing")).toBe(true);
  });

  it("short-circuits a ternary", () => {
    expect(runExpression("true ? 1 : missing")).toBe(1);
    expect(runExpression("false ? missing : 2")).toBe(2);
  });

  it("throws on a genuinely undefined variable", () => {
    expect(() => runExpression("a + 1")).toThrow();
  });
});

describe("VM matches the tree-walking evaluator", () => {
  const scope = { variables: { x: 7, y: 2, z: 0 } };
  const expressions = [
    "x + y * 2",
    "(x - y) / 2",
    "x > y ? x : y",
    "x > 100 || y < 5",
    "x > 0 && y > 0",
    "abs(z - x)",
    "x % y",
    "-x + 10",
    "!(x > y)",
    "x == 7 ? y : z",
  ];

  it("produces identical results for every expression", () => {
    for (const src of expressions) {
      expect(runExpression(src, scope)).toBe(evaluateExpression(src, scope));
    }
  });

  it("compiles to a non-empty instruction sequence", () => {
    expect(compile(parseExpression("1 + 2")).length).toBeGreaterThan(0);
  });
});
