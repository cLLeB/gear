import { describe, expect, it } from "vitest";
import { DiagnosticsEngine } from "../engine";
import { delimiterAnalyzer } from "./delimiters";

const engine = new DiagnosticsEngine().register(delimiterAnalyzer);
const run = (src: string) => engine.run(src, "javascript");

describe("delimiterAnalyzer", () => {
  it("accepts balanced code", () => {
    expect(run("function f() { return [1, 2]; }")).toHaveLength(0);
  });

  it("flags an unclosed brace", () => {
    const d = run("function f() {");
    expect(d[0]).toMatchObject({ code: "unclosed-bracket" });
    expect(d[0].message).toContain("}");
  });

  it("flags an unexpected close", () => {
    const d = run("foo())");
    expect(d[0].code).toBe("unmatched-close");
  });

  it("flags a mismatched pair", () => {
    const d = run("foo(]");
    expect(d.some((x) => x.code === "mismatched-bracket")).toBe(true);
  });

  it("ignores brackets inside strings and comments", () => {
    expect(run('const s = "([{"; // )]}')).toHaveLength(0);
  });

  it("offers a quick fix", () => {
    const d = run("foo(");
    expect(d[0].fixes?.[0].edits[0].insert).toBe(")");
  });
});
