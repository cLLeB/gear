import { describe, expect, it } from "vitest";
import { allBindings, buildScopeTree, resolveBinding, scopeAt } from "./scopes";

describe("buildScopeTree (brace languages)", () => {
  it("binds top-level declarations to the global scope", () => {
    const root = buildScopeTree("const a = 1;\nlet b = 2;\nvar c = 3;\n", "javascript");
    expect(root.bindings.get("a")?.[0].kind).toBe("const");
    expect(root.bindings.get("b")?.[0].kind).toBe("let");
    expect(root.bindings.get("c")?.[0].kind).toBe("var");
  });

  it("creates a function scope and binds its parameters", () => {
    const src = "function add(x, y) {\n  return x + y;\n}\n";
    const root = buildScopeTree(src, "javascript");
    const fn = root.children.find((s) => s.kind === "function");
    expect(fn).toBeDefined();
    expect(fn!.bindings.has("x")).toBe(true);
    expect(fn!.bindings.has("y")).toBe(true);
    expect(fn!.bindings.get("x")?.[0].kind).toBe("param");
  });

  it("hoists var to the function scope but keeps let block-scoped", () => {
    const src = "function f() {\n  { var hoisted = 1; let blocked = 2; }\n}\n";
    const root = buildScopeTree(src, "javascript");
    const fn = root.children.find((s) => s.kind === "function")!;
    const block = fn.children.find((s) => s.kind === "block")!;
    expect(fn.bindings.has("hoisted")).toBe(true); // hoisted up
    expect(block.bindings.has("blocked")).toBe(true); // stayed
    expect(fn.bindings.has("blocked")).toBe(false);
  });

  it("binds arrow-function parameters into the arrow body scope", () => {
    const src = "const f = (a, b) => {\n  return a;\n};\n";
    const root = buildScopeTree(src, "javascript");
    const arrow = root.children.find((s) => s.kind === "function")!;
    expect(arrow.bindings.has("a")).toBe(true);
    expect(arrow.bindings.has("b")).toBe(true);
  });

  it("resolves a name from an inner scope outward", () => {
    const src = "const outer = 1;\nfunction f() {\n  return outer;\n}\n";
    const root = buildScopeTree(src, "javascript");
    const useOffset = src.indexOf("return outer") + "return ".length;
    const inner = scopeAt(root, useOffset);
    const binding = resolveBinding(inner, "outer");
    expect(binding?.kind).toBe("const");
  });
});

describe("buildScopeTree (python)", () => {
  it("binds defs, classes and their parameters by indentation", () => {
    const src = "def greet(name):\n    x = 1\n    return name\n";
    const root = buildScopeTree(src, "python");
    expect(root.bindings.has("greet")).toBe(true);
    const fn = root.children.find((s) => s.kind === "function")!;
    expect(fn.bindings.has("name")).toBe(true);
    expect(fn.bindings.has("x")).toBe(true);
  });

  it("does not bind self/cls as parameters", () => {
    const src = "class A:\n    def m(self, v):\n        return v\n";
    const root = buildScopeTree(src, "python");
    const all = allBindings(root).map((b) => b.name);
    expect(all).toContain("v");
    expect(all).not.toContain("self");
  });
});
