import { describe, expect, it } from "vitest";
import { numberToWords } from "./numberToWords";

describe("numberToWords", () => {
  it("handles small numbers", () => {
    expect(numberToWords(0)).toBe("zero");
    expect(numberToWords(7)).toBe("seven");
    expect(numberToWords(42)).toBe("forty-two");
  });

  it("handles hundreds and thousands", () => {
    expect(numberToWords(305)).toBe("three hundred five");
    expect(numberToWords(1234)).toBe("one thousand two hundred thirty-four");
  });

  it("handles millions", () => {
    expect(numberToWords(2_000_001)).toBe("two million one");
  });

  it("handles negatives", () => {
    expect(numberToWords(-15)).toBe("negative fifteen");
  });
});
