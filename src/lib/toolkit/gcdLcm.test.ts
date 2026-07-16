import { describe, expect, it } from "vitest";
import { gcd, lcm, simplifyFraction } from "./gcdLcm";

describe("gcdLcm", () => {
  it("computes gcd", () => {
    expect(gcd(12, 18)).toBe(6);
    expect(gcd(-8, 12)).toBe(4);
  });

  it("computes lcm", () => {
    expect(lcm(4, 6)).toBe(12);
    expect(lcm(0, 5)).toBe(0);
  });

  it("simplifies fractions", () => {
    expect(simplifyFraction(6, 8)).toEqual([3, 4]);
    expect(simplifyFraction(2, -4)).toEqual([-1, 2]);
  });
});
