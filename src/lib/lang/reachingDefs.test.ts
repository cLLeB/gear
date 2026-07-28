import { describe, expect, it } from "vitest";
import { assignmentsReaching, reachingDefinitions } from "./reachingDefs";

const chainFor = (src: string, variable: string, needle: string) => {
  const useOffset = src.indexOf(needle);
  return reachingDefinitions(src, "javascript").find(
    (c) => c.variable === variable && useOffset >= c.use.from && useOffset <= c.use.to,
  );
};

describe("reachingDefinitions", () => {
  it("links a read to its single assignment", () => {
    const src = "function f() {\n  let x = 1;\n  return x;\n}\n";
    const chain = chainFor(src, "x", "return x");
    expect(chain?.definitions).toHaveLength(1);
    expect(src.slice(chain!.definitions[0].from, chain!.definitions[0].to)).toContain("let x = 1");
  });

  it("sees only the latest assignment after an overwrite", () => {
    const src = "function f() {\n  let x = 1;\n  x = 2;\n  return x;\n}\n";
    const chain = chainFor(src, "x", "return x");
    expect(chain?.definitions).toHaveLength(1);
    expect(src.slice(chain!.definitions[0].from, chain!.definitions[0].to)).toContain("x = 2");
  });

  it("sees both branches' assignments after a conditional (may-reach)", () => {
    const src = [
      "function f(c) {",
      "  let x = 1;",
      "  if (c) { x = 2; }",
      "  return x;",
      "}",
    ].join("\n");
    const chain = chainFor(src, "x", "return x");
    // Both `let x = 1` (fall-through) and `x = 2` (then-branch) may reach.
    expect(chain?.definitions.length).toBe(2);
  });

  it("threads a loop-carried definition back to the read", () => {
    const src = [
      "function f(n) {",
      "  let acc = 0;",
      "  while (n > 0) { acc = acc + n; n = n - 1; }",
      "  return acc;",
      "}",
    ].join("\n");
    const chain = chainFor(src, "acc", "return acc");
    // Both the initial `acc = 0` and the in-loop `acc = acc + n` may reach.
    expect(chain!.definitions.length).toBe(2);
  });
});

describe("assignmentsReaching", () => {
  it("returns the reaching assignment sites for a read at an offset", () => {
    const src = "function f() {\n  let total = 10;\n  return total;\n}\n";
    const offset = src.indexOf("return total");
    const sites = assignmentsReaching(src, "javascript", offset);
    expect(sites.map((s) => s.variable)).toContain("total");
  });
});
