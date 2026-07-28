import { describe, expect, it } from "vitest";
import { analyzeTaint } from "./taint";

const flows = (src: string) => analyzeTaint(src, "javascript");

describe("analyzeTaint", () => {
  it("reports tainted input flowing into a sink", () => {
    const src = "function f() {\n  let x = readInput();\n  eval(x);\n}\n";
    const result = flows(src);
    expect(result).toHaveLength(1);
    expect(result[0].sink).toBe("eval");
    expect(result[0].variable).toBe("x");
  });

  it("clears taint through a sanitizer", () => {
    const src = "function f() {\n  let x = readInput();\n  let y = escape(x);\n  eval(y);\n}\n";
    expect(flows(src)).toEqual([]);
  });

  it("does not flag clean constant data", () => {
    const src = 'function f() {\n  let x = "static";\n  eval(x);\n}\n';
    expect(flows(src)).toEqual([]);
  });

  it("flags a direct source-into-sink call", () => {
    const src = "function f() {\n  exec(readInput());\n}\n";
    const result = flows(src);
    expect(result).toHaveLength(1);
    expect(result[0].sink).toBe("exec");
    expect(result[0].variable).toBeNull();
  });

  it("propagates taint through an assignment chain", () => {
    const src = "function f() {\n  let a = readInput();\n  let b = a;\n  query(b);\n}\n";
    const result = flows(src);
    expect(result.map((r) => r.variable)).toContain("b");
  });

  it("reports taint that reaches a sink on only one branch", () => {
    const src = [
      "function f(c) {",
      "  let x = 0;",
      "  if (c) { x = readInput(); }",
      "  eval(x);",
      "}",
    ].join("\n");
    const result = flows(src);
    expect(result.map((r) => r.variable)).toContain("x");
  });

  it("clears taint when a variable is reassigned to a clean value on all paths", () => {
    const src = [
      "function f() {",
      "  let x = readInput();",
      "  x = 42;",
      "  eval(x);",
      "}",
    ].join("\n");
    expect(flows(src)).toEqual([]);
  });
});
