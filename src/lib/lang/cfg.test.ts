import { describe, expect, it } from "vitest";
import { basicBlocks, findUnreachableCode } from "./cfg";

function deadText(src: string, lang = "javascript"): string[] {
  return findUnreachableCode(src, lang).map((r) => src.slice(r.from, r.to).trim());
}

describe("findUnreachableCode", () => {
  it("flags a statement after an unconditional return", () => {
    const src = "function f() {\n  return 1;\n  console.log('dead');\n}\n";
    const dead = deadText(src);
    expect(dead.join(" ")).toContain("console.log('dead')");
  });

  it("does NOT flag code after a guarded (conditional) return", () => {
    const src = "function f(x) {\n  if (x) return 1;\n  return 2;\n}\n";
    expect(findUnreachableCode(src, "javascript")).toEqual([]);
  });

  it("does not treat code in a nested block as dead once the block closes", () => {
    const src = "function f(x) {\n  if (x) { return 1; }\n  doWork();\n}\n";
    expect(findUnreachableCode(src, "javascript")).toEqual([]);
  });

  it("resets reachability at switch case labels", () => {
    const src = "function f(x) {\n  switch (x) {\n    case 1: return 1;\n    case 2: return 2;\n  }\n}\n";
    // return in case 1 must not mark `case 2` unreachable.
    expect(findUnreachableCode(src, "javascript")).toEqual([]);
  });

  it("flags code after throw and after break", () => {
    const thrown = "function f() {\n  throw new Error('x');\n  cleanup();\n}\n";
    expect(deadText(thrown).join(" ")).toContain("cleanup()");
    const broke = "function f() {\n  for (;;) {\n    break;\n    never();\n  }\n}\n";
    expect(deadText(broke).join(" ")).toContain("never()");
  });

  it("returns nothing for straight-line code", () => {
    const src = "function f() {\n  const a = 1;\n  const b = 2;\n  return a + b;\n}\n";
    expect(findUnreachableCode(src, "javascript")).toEqual([]);
  });
});

describe("basicBlocks", () => {
  it("marks blocks after a terminator as unreachable", () => {
    const src = "function f() {\n  return 1;\n  dead();\n}\n";
    const blocks = basicBlocks(src, "javascript");
    expect(blocks.some((b) => !b.reachable)).toBe(true);
  });
});
