import { describe, expect, it } from "vitest";
import { fromRoman, toRoman } from "./romanNumerals";

describe("romanNumerals", () => {
  it("converts to roman", () => {
    expect(toRoman(4)).toBe("IV");
    expect(toRoman(1994)).toBe("MCMXCIV");
    expect(toRoman(2024)).toBe("MMXXIV");
  });

  it("rejects out-of-range", () => {
    expect(() => toRoman(0)).toThrow();
    expect(() => toRoman(4000)).toThrow();
  });

  it("parses from roman", () => {
    expect(fromRoman("IV")).toBe(4);
    expect(fromRoman("MCMXCIV")).toBe(1994);
  });

  it("rejects invalid numerals", () => {
    expect(fromRoman("IIII")).toBeNull();
    expect(fromRoman("ABC")).toBeNull();
  });
});
