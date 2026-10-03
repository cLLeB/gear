import { describe, expect, it } from "vitest";
import { parseRulers } from "./editorGuides";

describe("parseRulers", () => {
  it("parses lists in any separator style", () => {
    expect(parseRulers("120, 80;100 80")).toEqual([80, 100, 120]);
  });
  it("drops invalid values", () => {
    expect(parseRulers("abc, -4, 0, 5000, 72")).toEqual([72]);
    expect(parseRulers("")).toEqual([]);
  });
});
