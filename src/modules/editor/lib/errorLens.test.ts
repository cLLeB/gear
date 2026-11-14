import { describe, expect, it } from "vitest";
import { lensMessage, summarizeLines, type LensDiagnostic } from "./errorLens";

// Ten characters per line keeps positions easy to read.
const lineOf = (pos: number) => Math.floor(pos / 10) + 1;

describe("summarizeLines", () => {
  it("returns nothing without diagnostics", () => {
    expect(summarizeLines([], lineOf)).toEqual([]);
  });

  it("keeps the most severe diagnostic per line and counts the rest", () => {
    const diags: LensDiagnostic[] = [
      { from: 2, severity: "warning", message: "unused variable" },
      { from: 5, severity: "error", message: "missing semicolon" },
      { from: 7, severity: "info", message: "consider const" },
    ];
    expect(summarizeLines(diags, lineOf)).toEqual([
      { line: 1, severity: "error", message: "missing semicolon", more: 2 },
    ]);
  });

  it("prefers the earliest diagnostic when severities tie", () => {
    const diags: LensDiagnostic[] = [
      { from: 8, severity: "error", message: "second" },
      { from: 1, severity: "error", message: "first" },
    ];
    expect(summarizeLines(diags, lineOf)[0]).toMatchObject({ message: "first", more: 1 });
  });

  it("sorts results by line", () => {
    const diags: LensDiagnostic[] = [
      { from: 35, severity: "hint", message: "c" },
      { from: 3, severity: "warning", message: "a" },
      { from: 12, severity: "error", message: "b" },
    ];
    expect(summarizeLines(diags, lineOf).map((l) => l.line)).toEqual([1, 2, 4]);
  });
});

describe("lensMessage", () => {
  it("keeps only the first line", () => {
    expect(lensMessage("  Type 'x' is wrong.\n  Details follow  ")).toBe("Type 'x' is wrong.");
  });

  it("caps long messages", () => {
    const out = lensMessage("a".repeat(500));
    expect(out.length).toBe(160);
    expect(out.endsWith("…")).toBe(true);
  });
});
