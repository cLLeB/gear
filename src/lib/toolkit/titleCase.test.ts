import { describe, expect, it } from "vitest";
import { titleCase } from "./titleCase";

describe("titleCase", () => {
  it("capitalises significant words", () => {
    expect(titleCase("the quick brown fox")).toBe("The Quick Brown Fox");
  });

  it("keeps small words lower in the middle", () => {
    expect(titleCase("a tale of two cities")).toBe("A Tale of Two Cities");
  });

  it("always capitalises first and last word", () => {
    expect(titleCase("the end of")).toBe("The End Of");
  });

  it("handles hyphenated compounds", () => {
    expect(titleCase("well-known issue")).toBe("Well-Known Issue");
  });
});
