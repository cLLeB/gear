import { describe, expect, it } from "vitest";
import { levenshtein, similarity } from "./levenshtein";

describe("levenshtein", () => {
  it("is zero for equal strings", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
  });

  it("counts single edits", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });

  it("handles empty strings", () => {
    expect(levenshtein("", "abc")).toBe(3);
  });

  it("computes similarity", () => {
    expect(similarity("abc", "abc")).toBe(1);
    expect(similarity("abc", "abd")).toBeCloseTo(2 / 3, 5);
  });
});
