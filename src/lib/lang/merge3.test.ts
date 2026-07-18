import { describe, expect, it } from "vitest";
import { merge3 } from "./merge3";

describe("merge3", () => {
  it("takes the changed side when only one side edits a line", () => {
    const base = "a\nb\nc";
    const left = "a\nB\nc";
    const right = "a\nb\nc";
    const result = merge3(base, left, right);
    expect(result.text).toBe("a\nB\nc");
    expect(result.conflicts).toBe(0);
  });

  it("combines non-overlapping edits from both sides", () => {
    const base = "a\nb\nc\nd";
    const left = "a\nB\nc\nd";
    const right = "a\nb\nc\nD";
    const result = merge3(base, left, right);
    expect(result.text).toBe("a\nB\nc\nD");
    expect(result.conflicts).toBe(0);
  });

  it("keeps a single copy when both sides make the same change", () => {
    const base = "a\nb\nc";
    const same = "a\nX\nc";
    const result = merge3(base, same, same);
    expect(result.text).toBe("a\nX\nc");
    expect(result.conflicts).toBe(0);
  });

  it("emits conflict markers when both sides change a line differently", () => {
    const base = "a\nb\nc";
    const left = "a\nLEFT\nc";
    const right = "a\nRIGHT\nc";
    const result = merge3(base, left, right, { left: "mine", right: "theirs" });
    expect(result.conflicts).toBe(1);
    expect(result.text).toContain("<<<<<<< mine");
    expect(result.text).toContain("LEFT");
    expect(result.text).toContain("=======");
    expect(result.text).toContain("RIGHT");
    expect(result.text).toContain(">>>>>>> theirs");
  });

  it("merges an insertion made on one side", () => {
    const base = "line1\nline2";
    const left = "line1\ninserted\nline2";
    const right = "line1\nline2";
    const result = merge3(base, left, right);
    expect(result.text).toBe("line1\ninserted\nline2");
    expect(result.conflicts).toBe(0);
  });

  it("returns the base unchanged when neither side edits", () => {
    const base = "x\ny\nz";
    expect(merge3(base, base, base)).toEqual({ text: "x\ny\nz", conflicts: 0 });
  });
});
