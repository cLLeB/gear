import { describe, expect, it } from "vitest";
import {
  buildCallGraph,
  callersOf,
  calleesOf,
  recursiveGroups,
  stronglyConnectedComponents,
  unreachableFunctions,
} from "./callGraph";

describe("buildCallGraph", () => {
  it("discovers named functions and links caller to callee", () => {
    const src = [
      "function a() { b(); }",
      "function b() { c(); }",
      "function c() { return 1; }",
      "a();",
    ].join("\n");
    const g = buildCallGraph(src, "javascript");
    expect(g.functions.map((f) => f.name).sort()).toEqual(["a", "b", "c"]);
    expect(calleesOf(g, "a")).toEqual(["b"]);
    expect(calleesOf(g, "b")).toEqual(["c"]);
    expect(callersOf(g, "c")).toEqual(["b"]);
  });

  it("recognizes arrow and function-expression assignments", () => {
    const src = [
      "const helper = (x) => { return x + 1; };",
      "const main = function () { helper(1); };",
    ].join("\n");
    const g = buildCallGraph(src, "javascript");
    expect(g.functions.map((f) => f.name).sort()).toEqual(["helper", "main"]);
    expect(calleesOf(g, "main")).toEqual(["helper"]);
  });

  it("ignores method calls it cannot resolve by name", () => {
    const src = "function f() { obj.run(); bare(); }\nfunction bare() {}";
    const g = buildCallGraph(src, "javascript");
    // `obj.run` is skipped; `bare` resolves to a known function.
    expect(calleesOf(g, "f")).toEqual(["bare"]);
  });

  it("does not treat control keywords as calls", () => {
    const src = "function f() { if (true) { g(); } while (false) {} }\nfunction g() {}";
    const g = buildCallGraph(src, "javascript");
    expect(calleesOf(g, "f")).toEqual(["g"]);
  });

  it("handles Python indentation-scoped definitions", () => {
    const src = ["def outer():", "    inner()", "", "def inner():", "    return 1", "", "outer()"].join("\n");
    const g = buildCallGraph(src, "python");
    expect(g.functions.map((f) => f.name).sort()).toEqual(["inner", "outer"]);
    expect(calleesOf(g, "outer")).toEqual(["inner"]);
  });
});

describe("recursiveGroups", () => {
  it("detects direct self-recursion", () => {
    const src = "function fact(n) { return fact(n - 1); }";
    const g = buildCallGraph(src, "javascript");
    expect(recursiveGroups(g)).toEqual([["fact"]]);
  });

  it("detects mutual recursion as one group", () => {
    const src = [
      "function isEven(n) { return isOdd(n - 1); }",
      "function isOdd(n) { return isEven(n - 1); }",
    ].join("\n");
    const g = buildCallGraph(src, "javascript");
    expect(recursiveGroups(g)).toEqual([["isEven", "isOdd"]]);
  });

  it("returns nothing for an acyclic graph", () => {
    const src = "function a() { b(); }\nfunction b() {}";
    const g = buildCallGraph(src, "javascript");
    expect(recursiveGroups(g)).toEqual([]);
  });
});

describe("stronglyConnectedComponents", () => {
  it("orders callees before callers (reverse topological)", () => {
    const src = "function a() { b(); }\nfunction b() { c(); }\nfunction c() {}";
    const g = buildCallGraph(src, "javascript");
    const scc = stronglyConnectedComponents(g).map((c) => c[0]);
    expect(scc).toEqual(["c", "b", "a"]);
  });
});

describe("unreachableFunctions", () => {
  it("reports functions not reachable from an entry point", () => {
    const src = [
      "function main() { used(); }",
      "function used() {}",
      "function orphan() {}",
    ].join("\n");
    const g = buildCallGraph(src, "javascript");
    expect(unreachableFunctions(g, ["main"])).toEqual(["orphan"]);
  });

  it("uses top-level calls as implicit roots when no entry points given", () => {
    const src = [
      "function reached() { helper(); }",
      "function helper() {}",
      "function dead() {}",
      "reached();",
    ].join("\n");
    const g = buildCallGraph(src, "javascript");
    expect(unreachableFunctions(g)).toEqual(["dead"]);
  });
});
