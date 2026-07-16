import { describe, expect, it } from "vitest";
import { diffLinesMyers, editDistance, myersDiff } from "./myersDiff";

const reconstruct = <T>(diff: { op: string; value: T }[]) => ({
  a: diff.filter((e) => e.op !== "insert").map((e) => e.value),
  b: diff.filter((e) => e.op !== "delete").map((e) => e.value),
});

describe("myersDiff", () => {
  it("returns all-equal for identical input", () => {
    const d = myersDiff([1, 2, 3], [1, 2, 3]);
    expect(d.every((e) => e.op === "equal")).toBe(true);
  });

  it("reconstructs both sequences exactly", () => {
    const a = "ABCABBA".split("");
    const b = "CBABAC".split("");
    const { a: ra, b: rb } = reconstruct(myersDiff(a, b));
    expect(ra).toEqual(a);
    expect(rb).toEqual(b);
  });

  it("finds a minimal edit distance", () => {
    // Classic Myers example: ABCABBA -> CBABAC has SES length 5.
    const d = myersDiff("ABCABBA".split(""), "CBABAC".split(""));
    expect(editDistance(d)).toBe(5);
  });

  it("handles pure insertion and deletion", () => {
    expect(editDistance(myersDiff([], [1, 2, 3]))).toBe(3);
    expect(editDistance(myersDiff([1, 2, 3], []))).toBe(3);
  });

  it("diffs lines", () => {
    const d = diffLinesMyers("a\nb\nc", "a\nx\nc");
    expect(d.map((e) => `${e.op[0]}${e.value}`)).toContain("db");
    expect(d.map((e) => `${e.op[0]}${e.value}`)).toContain("ix");
  });

  it("supports a custom equality", () => {
    const d = myersDiff(["A", "b"], ["a", "B"], (x, y) => x.toLowerCase() === y.toLowerCase());
    expect(d.every((e) => e.op === "equal")).toBe(true);
  });
});
