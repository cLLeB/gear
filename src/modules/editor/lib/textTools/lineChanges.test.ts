import { describe, expect, it } from "vitest";
import { hunkStarts, lineChanges } from "./lineChanges";

describe("lineChanges", () => {
  it("marks added, modified and deleted lines", () => {
    const base = "a\nb\nc\nd\ne";
    const current = "a\nB\nc\nnew1\nnew2\nd";
    expect(lineChanges(base, current)).toEqual([
      { line: 2, kind: "modified" },
      { line: 4, kind: "added" },
      { line: 5, kind: "added" },
      { line: 6, kind: "deleted" },
    ]);
  });

  it("reports a deletion at the top on line 1", () => {
    expect(lineChanges("x\na\nb", "a\nb")).toEqual([{ line: 1, kind: "deleted" }]);
  });

  it("is empty for identical text", () => {
    expect(lineChanges("same\ntext", "same\ntext")).toEqual([]);
  });
});

describe("hunkStarts", () => {
  it("collapses contiguous lines into hunks", () => {
    expect(
      hunkStarts([
        { line: 2, kind: "modified" },
        { line: 3, kind: "added" },
        { line: 9, kind: "deleted" },
      ]),
    ).toEqual([2, 9]);
  });
});
