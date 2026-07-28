import { describe, expect, it } from "vitest";
import { runDiagnostics } from "../index";
import { unreachableCodeAnalyzer } from "./controlFlow";
import { unusedSymbolsAnalyzer } from "./unusedSymbols";

describe("control-flow + unused analyzers wired into the engine", () => {
  it("reports unreachable code through the default engine", () => {
    const src = "function f() {\n  return 1;\n  dead();\n}\n";
    const diags = runDiagnostics(src, "javascript");
    expect(diags.some((d) => d.code === "unreachable-code")).toBe(true);
  });

  it("reports an unused local through the default engine", () => {
    const src = "function f() {\n  const dead = 1;\n  return 2;\n}\n";
    const diags = runDiagnostics(src, "javascript");
    expect(diags.some((d) => d.code === "unused-declaration" && d.message.includes("dead"))).toBe(true);
  });

  it("unreachable analyzer only applies to brace languages", () => {
    expect(unreachableCodeAnalyzer.appliesTo!("python", { braceBlocks: false } as never)).toBe(false);
    expect(unreachableCodeAnalyzer.appliesTo!("javascript", { braceBlocks: true } as never)).toBe(true);
  });

  it("unused analyzer produces hint severity", () => {
    const src = "function f(unusedParam) {\n  return 1;\n}\n";
    const diags = unusedSymbolsAnalyzer.analyze({
      source: src, languageId: "javascript", spec: null, tokens: [],
      positions: undefined as never,
    });
    expect(diags.every((d) => d.severity === "hint")).toBe(true);
    expect(diags.some((d) => d.code === "unused-parameter")).toBe(true);
  });
});
