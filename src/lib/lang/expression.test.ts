import { describe, expect, it } from "vitest";
import { evaluateExpression, ExpressionError, parseExpression } from "./expression";

const ev = (s: string, scope?: Parameters<typeof evaluateExpression>[1]) => evaluateExpression(s, scope);

describe("expression evaluator", () => {
  it("respects arithmetic precedence", () => {
    expect(ev("2 + 3 * 4")).toBe(14);
    expect(ev("(2 + 3) * 4")).toBe(20);
  });

  it("handles right-associative exponentiation", () => {
    expect(ev("2 ** 3 ** 2")).toBe(512);
  });

  it("handles unary minus and not", () => {
    expect(ev("-2 ** 2")).toBe(-4); // unary minus binds looser than ** (Python-like)
    expect(ev("-(3)")).toBe(-3);
    expect(ev("!false")).toBe(true);
  });

  it("evaluates comparisons and boolean logic", () => {
    expect(ev("3 > 2 && 1 < 2")).toBe(true);
    expect(ev("1 == 1 || 2 == 3")).toBe(true);
  });

  it("supports a ternary", () => {
    expect(ev("5 > 3 ? 10 : 20")).toBe(10);
  });

  it("reads variables and calls functions", () => {
    expect(ev("max(x, y) + 1", { variables: { x: 3, y: 7 } })).toBe(8);
    expect(ev("sqrt(n)", { variables: { n: 16 } })).toBe(4);
  });

  it("supports custom functions", () => {
    expect(ev("double(21)", { functions: { double: (x) => x * 2 } })).toBe(42);
  });

  it("produces a reusable AST", () => {
    const ast = parseExpression("a * a");
    expect(ast.kind).toBe("binary");
  });

  it("throws on malformed input", () => {
    expect(() => ev("2 +")).toThrow(ExpressionError);
    expect(() => ev("(1 + 2")).toThrow(ExpressionError);
    expect(() => ev("foo(")).toThrow(ExpressionError);
  });

  it("throws on undefined variables and functions", () => {
    expect(() => ev("missing")).toThrow(ExpressionError);
    expect(() => ev("nope(1)")).toThrow(ExpressionError);
  });
});
