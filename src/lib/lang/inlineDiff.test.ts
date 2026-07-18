import { describe, expect, it } from "vitest";
import { charDiff, modifiedText, originalText, wordDiff } from "./inlineDiff";

describe("wordDiff", () => {
  it("isolates the changed word", () => {
    const segs = wordDiff("the quick fox", "the slow fox");
    expect(segs).toEqual([
      { type: "equal", text: "the " },
      { type: "delete", text: "quick" },
      { type: "insert", text: "slow" },
      { type: "equal", text: " fox" },
    ]);
  });

  it("handles pure insertion", () => {
    const segs = wordDiff("a c", "a b c");
    expect(segs.filter((s) => s.type === "insert").map((s) => s.text).join("")).toContain("b");
  });

  it("reconstructs both sides", () => {
    const a = "the quick brown fox";
    const b = "the lazy brown dog";
    const segs = wordDiff(a, b);
    expect(originalText(segs)).toBe(a);
    expect(modifiedText(segs)).toBe(b);
  });
});

describe("charDiff", () => {
  it("finds the single-character substitution", () => {
    const segs = charDiff("kitten", "sitten");
    expect(segs).toEqual([
      { type: "delete", text: "k" },
      { type: "insert", text: "s" },
      { type: "equal", text: "itten" },
    ]);
  });

  it("reconstructs both sides for arbitrary strings", () => {
    const a = "abcdef";
    const b = "azced";
    const segs = charDiff(a, b);
    expect(originalText(segs)).toBe(a);
    expect(modifiedText(segs)).toBe(b);
  });

  it("returns a single equal segment for identical input", () => {
    expect(charDiff("same", "same")).toEqual([{ type: "equal", text: "same" }]);
  });
});
