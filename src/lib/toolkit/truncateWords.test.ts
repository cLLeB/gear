import { describe, expect, it } from "vitest";
import { truncateWords } from "./truncateWords";

describe("truncateWords", () => {
  it("keeps text under the limit", () => {
    expect(truncateWords("one two", 5)).toBe("one two");
  });

  it("truncates and appends ellipsis", () => {
    expect(truncateWords("one two three four", 2)).toBe("one two…");
  });

  it("supports custom ellipsis", () => {
    expect(truncateWords("a b c", 1, { ellipsis: " ..." })).toBe("a ...");
  });

  it("handles zero", () => {
    expect(truncateWords("a b", 0)).toBe("");
  });
});
