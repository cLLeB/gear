import { describe, expect, it } from "vitest";
import { DiagnosticsEngine } from "../engine";
import { lexicalAnalyzer } from "./lexical";

const engine = new DiagnosticsEngine().register(lexicalAnalyzer);
const codes = (src: string) => engine.run(src, "javascript").map((d) => d.code);

describe("lexicalAnalyzer", () => {
  it("flags unterminated strings", () => {
    expect(codes('const s = "oops\n')).toContain("unterminated-string");
  });

  it("flags trailing whitespace", () => {
    expect(codes("const x = 1   \n")).toContain("trailing-whitespace");
  });

  it("flags a line mixing tabs and spaces", () => {
    expect(codes("if (x) {\n \t return\n}\n")).toContain("mixed-indent-line");
  });

  it("flags inconsistent indentation across lines", () => {
    expect(codes("a\n\tb\n  c\n")).toContain("inconsistent-indent");
  });

  it("flags a missing final newline", () => {
    expect(codes("const x = 1")).toContain("no-final-newline");
  });

  it("is clean for tidy code", () => {
    expect(codes("const x = 1\n")).toHaveLength(0);
  });
});
