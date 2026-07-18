import { describe, expect, it } from "vitest";
import { duplicatedTokenCount, findClones } from "./cloneDetection";

const block = (name: string) =>
  [
    `function ${name}(a, b) {`,
    "  const sum = a + b;",
    "  const scaled = sum * 2;",
    "  const clamped = scaled > 100 ? 100 : scaled;",
    "  return clamped + 1;",
    "}",
  ].join("\n");

describe("findClones", () => {
  it("finds an exact duplicated block (type-1)", () => {
    const src = block("first") + "\n\n" + block("second");
    const clones = findClones(src, "javascript", { minTokens: 15 });
    expect(clones.length).toBeGreaterThanOrEqual(1);
    // The two bodies overlap the second/first block ranges.
    const [c] = clones;
    expect(src.slice(c.a.from, c.a.to)).toContain("const sum = a + b");
    expect(src.slice(c.b.from, c.b.to)).toContain("const sum = a + b");
  });

  it("still detects clones after identifiers and literals are renamed (type-2)", () => {
    const original = block("first");
    const renamed = [
      "function other(x, y) {",
      "  const total = x + y;",
      "  const doubled = total * 9;",
      "  const capped = doubled > 500 ? 500 : doubled;",
      "  return capped + 7;",
      "}",
    ].join("\n");
    const clones = findClones(original + "\n\n" + renamed, "javascript", { minTokens: 15 });
    expect(clones.length).toBeGreaterThanOrEqual(1);
  });

  it("reports nothing when code is genuinely distinct", () => {
    const src = [
      "function alpha() { return 1; }",
      "function beta(list) { for (const x of list) { console.log(x); } }",
      "const z = Math.max(3, 4, 5);",
    ].join("\n");
    expect(findClones(src, "javascript", { minTokens: 20 })).toEqual([]);
  });

  it("does not report a block as a clone of itself", () => {
    const clones = findClones(block("solo"), "javascript", { minTokens: 15 });
    expect(clones).toEqual([]);
  });

  it("respects the minTokens threshold", () => {
    const tiny = "const a = 1; const a2 = 1;";
    expect(findClones(tiny, "javascript", { minTokens: 20 })).toEqual([]);
  });

  it("sums duplicated tokens across clones", () => {
    const src = block("first") + "\n\n" + block("second");
    const clones = findClones(src, "javascript", { minTokens: 15 });
    expect(duplicatedTokenCount(clones)).toBeGreaterThan(0);
  });
});
