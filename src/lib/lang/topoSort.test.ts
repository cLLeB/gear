import { describe, expect, it } from "vitest";
import { topologicalSort } from "./topoSort";

const graph = (obj: Record<string, string[]>) => new Map(Object.entries(obj));

const isValidOrder = (order: string[], deps: Record<string, string[]>): boolean => {
  const pos = new Map(order.map((n, i) => [n, i]));
  for (const [node, list] of Object.entries(deps)) {
    for (const dep of list) if (pos.get(dep)! > pos.get(node)!) return false;
  }
  return true;
};

describe("topologicalSort", () => {
  it("orders dependencies before dependents", () => {
    const deps = { a: ["b"], b: ["c"], c: [] };
    const { order, cycle } = topologicalSort(graph(deps));
    expect(cycle).toBeNull();
    expect(order).toEqual(["c", "b", "a"]);
  });

  it("produces a valid order for a diamond", () => {
    const deps = { app: ["ui", "core"], ui: ["core"], core: [] };
    const { order, cycle } = topologicalSort(graph(deps));
    expect(cycle).toBeNull();
    expect(isValidOrder(order, deps)).toBe(true);
    expect(order[0]).toBe("core");
  });

  it("includes nodes referenced only as dependencies", () => {
    const { order } = topologicalSort(graph({ a: ["b"] }));
    expect(order.sort()).toEqual(["a", "b"]);
  });

  it("orders independent nodes alphabetically (deterministic)", () => {
    const { order } = topologicalSort(graph({ c: [], a: [], b: [] }));
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("detects a simple cycle and returns its path", () => {
    const { order, cycle } = topologicalSort(graph({ a: ["b"], b: ["a"] }));
    expect(order).toEqual([]);
    expect(cycle).not.toBeNull();
    expect(new Set(cycle!)).toEqual(new Set(["a", "b"]));
  });

  it("detects a self-dependency", () => {
    const { cycle } = topologicalSort(graph({ x: ["x"] }));
    expect(cycle).toEqual(["x"]);
  });

  it("finds a cycle embedded in a larger graph", () => {
    const { order, cycle } = topologicalSort(graph({
      start: ["a"],
      a: ["b"],
      b: ["c"],
      c: ["a"], // a -> b -> c -> a
    }));
    expect(order).toEqual([]);
    expect(new Set(cycle!)).toEqual(new Set(["a", "b", "c"]));
  });
});
