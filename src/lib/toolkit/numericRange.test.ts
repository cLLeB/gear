import { describe, expect, it } from "vitest";
import { clamp, inverseLerp, lerp, mapRange, roundTo } from "./numericRange";

describe("numericRange", () => {
  it("clamps within bounds", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(20, 0, 10)).toBe(10);
  });

  it("tolerates reversed bounds", () => {
    expect(clamp(5, 10, 0)).toBe(5);
  });

  it("interpolates", () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(inverseLerp(0, 10, 5)).toBe(0.5);
  });

  it("remaps ranges with clamping", () => {
    expect(mapRange(5, 0, 10, 0, 100)).toBe(50);
    expect(mapRange(20, 0, 10, 0, 100)).toBe(100);
  });

  it("rounds to decimals", () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(3.14159, 2)).toBe(3.14);
  });
});
