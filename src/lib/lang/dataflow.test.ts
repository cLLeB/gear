import { describe, expect, it } from "vitest";
import { buildCfg, deadStores, livenessAnalysis } from "./dataflow";

const names = (stores: ReturnType<typeof deadStores>) => stores.map((s) => s.name);

describe("deadStores", () => {
  it("reports a variable assigned but never read", () => {
    const src = "function f() {\n  let dead = 5;\n  return 1;\n}\n";
    expect(names(deadStores(src, "javascript"))).toEqual(["dead"]);
  });

  it("does not report a variable that is later read", () => {
    const src = "function f() {\n  let used = 5;\n  return used;\n}\n";
    expect(names(deadStores(src, "javascript"))).toEqual([]);
  });

  it("reports the first assignment when a value is overwritten before use", () => {
    const src = "function f() {\n  let x = 1;\n  x = 2;\n  return x;\n}\n";
    const stores = deadStores(src, "javascript");
    expect(names(stores)).toEqual(["x"]);
    // It is the FIRST store (the `let x = 1`) that is dead.
    expect(src.slice(stores[0].from, stores[0].to)).toContain("let x = 1");
  });

  it("keeps a store live when it is read on only one branch", () => {
    const src = [
      "function f(c) {",
      "  let x = 1;",
      "  if (c) { x = 2; }",
      "  return x;",
      "}",
    ].join("\n");
    // x = 1 is read on the else path, so nothing is dead.
    expect(names(deadStores(src, "javascript"))).toEqual([]);
  });

  it("reports a store overwritten on every branch", () => {
    const src = [
      "function f(c) {",
      "  let x = 1;",
      "  if (c) { x = 2; } else { x = 3; }",
      "  return x;",
      "}",
    ].join("\n");
    expect(names(deadStores(src, "javascript"))).toEqual(["x"]);
  });

  it("treats a value read inside a loop as live across the back edge", () => {
    const src = [
      "function f(n) {",
      "  let sum = 0;",
      "  while (n > 0) { sum = sum + n; n = n - 1; }",
      "  return sum;",
      "}",
    ].join("\n");
    expect(names(deadStores(src, "javascript"))).toEqual([]);
  });

  it("does not flag a read-modify-write as a dead store", () => {
    const src = "function f() {\n  let x = 0;\n  x += 1;\n  return 0;\n}\n";
    // `x += 1` reads x, so it is never a dead store; but `let x = 0` feeds it, and
    // the final `x += 1` result is unread — only the RMW is exempt, the seed is live.
    const dead = names(deadStores(src, "javascript"));
    expect(dead).not.toContain("x"); // `let x = 0` is read by `x += 1`, so it is live
  });
});

describe("buildCfg / livenessAnalysis", () => {
  it("produces nodes with successor edges and reaches a fixpoint", () => {
    const src = "function f() {\n  let a = 1;\n  return a;\n}\n";
    const nodes = buildCfg(src, "javascript");
    expect(nodes.length).toBeGreaterThan(0);
    const { liveIn } = livenessAnalysis(nodes);
    // Every node has a computed live-in set.
    for (const n of nodes) expect(liveIn.has(n.id)).toBe(true);
  });

  it("returns no CFG for indentation-based languages", () => {
    expect(buildCfg("def f():\n    x = 1\n", "python")).toEqual([]);
  });
});
