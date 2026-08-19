import { describe, expect, it } from "vitest";
import {
  isNoop,
  joinLines,
  removeBlankLines,
  reverseLines,
  sortLines,
  sortLinesIgnoreCase,
  trimTrailingWhitespace,
  uniqueLines,
} from "./lineOps";

describe("sortLines", () => {
  it("orders alphabetically", () => {
    expect(sortLines(["pear", "apple", "fig"])).toEqual([
      "apple",
      "fig",
      "pear",
    ]);
  });

  it("compares digit runs numerically", () => {
    expect(sortLines(["item10", "item9", "item1"])).toEqual([
      "item1",
      "item9",
      "item10",
    ]);
  });

  it("reverses for descending", () => {
    expect(sortLines(["a", "b", "c"], "desc")).toEqual(["c", "b", "a"]);
  });

  it("does not mutate its input", () => {
    const input = ["b", "a"];
    sortLines(input);
    expect(input).toEqual(["b", "a"]);
  });

  it("handles an empty range", () => {
    expect(sortLines([])).toEqual([]);
  });
});

describe("sortLinesIgnoreCase", () => {
  it("puts differently-cased neighbours together", () => {
    expect(sortLinesIgnoreCase(["Beta", "alpha", "BETA", "Alpha"])).toEqual([
      "alpha",
      "Alpha",
      "Beta",
      "BETA",
    ]);
  });

  it("still separates them under the case-sensitive sort", () => {
    expect(sortLines(["b", "B", "a"])[0]).toBe("a");
  });
});

describe("uniqueLines", () => {
  it("keeps the first occurrence and the original order", () => {
    expect(uniqueLines(["b", "a", "b", "c", "a"])).toEqual(["b", "a", "c"]);
  });

  it("treats differently-cased lines as distinct", () => {
    expect(uniqueLines(["a", "A"])).toEqual(["a", "A"]);
  });

  it("collapses repeated blank lines to one", () => {
    expect(uniqueLines(["", "x", ""])).toEqual(["", "x"]);
  });
});

describe("reverseLines", () => {
  it("reverses without mutating", () => {
    const input = ["a", "b", "c"];
    expect(reverseLines(input)).toEqual(["c", "b", "a"]);
    expect(input).toEqual(["a", "b", "c"]);
  });
});

describe("trimTrailingWhitespace", () => {
  it("strips trailing spaces and tabs", () => {
    expect(trimTrailingWhitespace(["a  ", "b\t\t", "c"])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("preserves leading indentation", () => {
    expect(trimTrailingWhitespace(["    indented   "])).toEqual([
      "    indented",
    ]);
  });

  it("empties a whitespace-only line", () => {
    expect(trimTrailingWhitespace(["   "])).toEqual([""]);
  });
});

describe("removeBlankLines", () => {
  it("drops empty and whitespace-only lines", () => {
    expect(removeBlankLines(["a", "", "  ", "\t", "b"])).toEqual(["a", "b"]);
  });

  it("can remove everything", () => {
    expect(removeBlankLines(["", " "])).toEqual([]);
  });
});

describe("joinLines", () => {
  it("collapses onto one line separated by a space", () => {
    expect(joinLines(["const a =", "  1 + 2;"])).toEqual(["const a = 1 + 2;"]);
  });

  it("keeps the first line's indentation", () => {
    expect(joinLines(["    foo", "    bar"])).toEqual(["    foo bar"]);
  });

  it("skips blank lines rather than emitting double separators", () => {
    expect(joinLines(["a", "", "b"])).toEqual(["a b"]);
  });

  it("accepts a custom separator", () => {
    expect(joinLines(["a", "b"], ", ")).toEqual(["a, b"]);
  });

  it("returns a single empty line for an all-blank range", () => {
    expect(joinLines(["", "  "])).toEqual([""]);
  });
});

describe("isNoop", () => {
  it("is true when nothing changed", () => {
    expect(isNoop(["a", "b"], ["a", "b"])).toBe(true);
  });

  it("is false when the length changed", () => {
    expect(isNoop(["a", "b"], ["a"])).toBe(false);
  });

  it("is false when a line changed", () => {
    expect(isNoop(["a"], ["b"])).toBe(false);
  });
});
