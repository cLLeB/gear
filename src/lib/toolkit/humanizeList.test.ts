import { describe, expect, it } from "vitest";
import { humanizeList } from "./humanizeList";

describe("humanizeList", () => {
  it("joins three items with a conjunction", () => {
    expect(humanizeList(["a", "b", "c"], { locale: "en" })).toBe("a, b, and c");
  });

  it("supports disjunction", () => {
    expect(humanizeList(["a", "b"], { type: "disjunction", locale: "en" })).toBe("a or b");
  });

  it("handles small lists", () => {
    expect(humanizeList([])).toBe("");
    expect(humanizeList(["solo"])).toBe("solo");
  });
});
