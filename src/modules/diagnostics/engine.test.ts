import { describe, expect, it } from "vitest";
import { countBySeverity, DiagnosticsEngine, type Analyzer } from "./engine";

const tokenCounter: Analyzer = {
  name: "token-counter",
  analyze: (ctx) =>
    ctx.tokens.length > 3
      ? [{ from: 0, to: 1, severity: "warning", message: "many tokens", source: "test" }]
      : [],
};

const jsOnly: Analyzer = {
  name: "js-only",
  appliesTo: (id) => id === "javascript",
  analyze: () => [{ from: 5, to: 6, severity: "error", message: "js", source: "test" }],
};

describe("DiagnosticsEngine", () => {
  it("runs registered analyzers and merges results", () => {
    const engine = new DiagnosticsEngine().register(tokenCounter).register(jsOnly);
    const diags = engine.run("const x = 1", "javascript");
    expect(diags.some((d) => d.message === "many tokens")).toBe(true);
    expect(diags.some((d) => d.message === "js")).toBe(true);
  });

  it("respects appliesTo language filtering", () => {
    const engine = new DiagnosticsEngine().register(jsOnly);
    expect(engine.run("x", "python")).toHaveLength(0);
  });

  it("sorts errors before warnings then by position", () => {
    const engine = new DiagnosticsEngine().register(tokenCounter).register(jsOnly);
    const diags = engine.run("const x = 1", "javascript");
    expect(diags[0].severity).toBe("error");
  });

  it("isolates a throwing analyzer", () => {
    const engine = new DiagnosticsEngine()
      .register({ name: "boom", analyze: () => { throw new Error("x"); } })
      .register(tokenCounter);
    expect(() => engine.run("const x = 1", "javascript")).not.toThrow();
  });

  it("supports only-filtering and limits", () => {
    const engine = new DiagnosticsEngine().register(tokenCounter).register(jsOnly);
    const diags = engine.run("const x = 1", "javascript", { only: ["js-only"] });
    expect(diags).toHaveLength(1);
  });

  it("counts by severity", () => {
    const counts = countBySeverity([
      { from: 0, to: 1, severity: "error", message: "", source: "t" },
      { from: 0, to: 1, severity: "error", message: "", source: "t" },
      { from: 0, to: 1, severity: "warning", message: "", source: "t" },
    ]);
    expect(counts).toMatchObject({ error: 2, warning: 1 });
  });
});
