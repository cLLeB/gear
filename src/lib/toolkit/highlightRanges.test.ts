import { describe, expect, it } from "vitest";
import { highlightRanges } from "./highlightRanges";

describe("highlightRanges", () => {
  it("marks matched characters", () => {
    expect(highlightRanges("abc", [1])).toEqual([
      { text: "a", match: false },
      { text: "b", match: true },
      { text: "c", match: false },
    ]);
  });

  it("merges consecutive matches", () => {
    expect(highlightRanges("abcd", [1, 2])).toEqual([
      { text: "a", match: false },
      { text: "bc", match: true },
      { text: "d", match: false },
    ]);
  });

  it("handles no matches", () => {
    expect(highlightRanges("abc", [])).toEqual([{ text: "abc", match: false }]);
  });

  it("handles leading match", () => {
    expect(highlightRanges("ab", [0])).toEqual([
      { text: "a", match: true },
      { text: "b", match: false },
    ]);
  });
});
