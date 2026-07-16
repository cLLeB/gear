import { describe, expect, it } from "vitest";
import { isValidLuhn, luhnCheckDigit } from "./luhn";

describe("luhn", () => {
  it("validates a known-good number", () => {
    expect(isValidLuhn("4539 1488 0343 6467")).toBe(true);
  });

  it("rejects a bad number", () => {
    expect(isValidLuhn("1234 5678 9012 3456")).toBe(false);
  });

  it("rejects non-numeric input", () => {
    expect(isValidLuhn("abc")).toBe(false);
  });

  it("computes the check digit", () => {
    expect(luhnCheckDigit("7992739871")).toBe(3);
    expect(isValidLuhn("79927398713")).toBe(true);
  });
});
