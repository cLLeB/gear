import { describe, expect, it } from "vitest";
import { foldConstants, renderExpr, simplifyExpression } from "./simplify";
import { parseExpression } from "./expression";

describe("simplifyExpression", () => {
  it("folds a fully constant expression", () => {
    expect(simplifyExpression("2 + 3 * 4")).toBe("14");
  });

  it("evaluates constant builtin calls", () => {
    expect(simplifyExpression("max(2, 8) - 1")).toBe("7");
  });

  it("applies additive and multiplicative identities", () => {
    expect(simplifyExpression("x + 0")).toBe("x");
    expect(simplifyExpression("0 + x")).toBe("x");
    expect(simplifyExpression("x * 1")).toBe("x");
    expect(simplifyExpression("x - 0")).toBe("x");
    expect(simplifyExpression("x / 1")).toBe("x");
  });

  it("annihilates a pure operand times zero", () => {
    expect(simplifyExpression("x * 0")).toBe("0");
  });

  it("does NOT annihilate a call times zero (possible side effect)", () => {
    expect(simplifyExpression("f(x) * 0")).toBe("f(x) * 0");
  });

  it("simplifies boolean short-circuits", () => {
    expect(simplifyExpression("true && x")).toBe("x");
    expect(simplifyExpression("false || x")).toBe("x");
  });

  it("selects a branch of a constant ternary", () => {
    expect(simplifyExpression("true ? a : b")).toBe("a");
    expect(simplifyExpression("0 ? a : b")).toBe("b");
  });

  it("collapses double negation", () => {
    const folded = foldConstants(parseExpression("- -x"));
    expect(renderExpr(folded)).toBe("x");
  });

  it("preserves needed parentheses when re-rendering", () => {
    expect(simplifyExpression("(a + b) * c")).toBe("(a + b) * c");
  });

  it("partially folds a mixed expression", () => {
    expect(simplifyExpression("x + (2 * 3)")).toBe("x + 6");
  });
});
