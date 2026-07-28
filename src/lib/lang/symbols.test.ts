import { describe, expect, it } from "vitest";
import { extractSymbols, flattenSymbols } from "./symbols";

describe("extractSymbols (brace languages)", () => {
  it("finds top-level functions and classes", () => {
    const src = "function foo() {}\nclass Bar {}\n";
    const names = extractSymbols(src, "javascript").map((s) => s.name);
    expect(names).toContain("foo");
    expect(names).toContain("Bar");
  });

  it("captures arrow-function assignments", () => {
    const src = "const add = (a, b) => a + b;\nconst run = function() {};\n";
    const names = extractSymbols(src, "javascript").map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["add", "run"]));
  });

  it("nests declarations inside a class body", () => {
    const src = "class A {\n  method() {\n    function inner() {}\n  }\n}\n";
    const tree = extractSymbols(src, "javascript");
    const cls = tree.find((s) => s.name === "A");
    expect(cls).toBeDefined();
    expect(flattenSymbols(tree).some((s) => s.name === "inner")).toBe(true);
  });

  it("reports kinds", () => {
    const src = "interface I {}\nenum E {}\ntype T = number;\n";
    const kinds = extractSymbols(src, "typescript").map((s) => s.kind);
    expect(kinds).toEqual(expect.arrayContaining(["interface", "enum", "type"]));
  });
});

describe("extractSymbols (Python)", () => {
  it("nests methods under classes by indentation", () => {
    const src = ["class Animal:", "    def __init__(self):", "        pass", "    def speak(self):", "        return 1", ""].join("\n");
    const tree = extractSymbols(src, "python");
    const cls = tree.find((s) => s.name === "Animal");
    expect(cls?.children.map((c) => c.name)).toEqual(["__init__", "speak"]);
  });

  it("keeps top-level functions separate", () => {
    const src = ["def a():", "    pass", "def b():", "    pass", ""].join("\n");
    expect(extractSymbols(src, "python").map((s) => s.name)).toEqual(["a", "b"]);
  });
});
