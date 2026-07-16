import { describe, expect, it } from "vitest";
import { capitalize, capitalizeWords, swapCase, uncapitalize } from "./stringCase";

describe("stringCase", () => {
  it("capitalizes and uncapitalizes", () => {
    expect(capitalize("hello")).toBe("Hello");
    expect(uncapitalize("Hello")).toBe("hello");
  });

  it("swaps case", () => {
    expect(swapCase("Hello World")).toBe("hELLO wORLD");
  });

  it("capitalizes each word", () => {
    expect(capitalizeWords("the quick brown")).toBe("The Quick Brown");
  });

  it("handles empty input", () => {
    expect(capitalize("")).toBe("");
  });
});
