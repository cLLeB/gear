import { describe, expect, it } from "vitest";
import { jaroWinkler } from "./jaroWinkler";

describe("jaroWinkler", () => {
  it("is 1 for identical strings", () => {
    expect(jaroWinkler("martha", "martha")).toBe(1);
  });

  it("is 0 for no overlap", () => {
    expect(jaroWinkler("abc", "xyz")).toBe(0);
  });

  it("rewards prefix matches", () => {
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.961, 2);
    expect(jaroWinkler("dwayne", "duane")).toBeCloseTo(0.84, 2);
  });

  it("boosts shared prefixes over jaro alone", () => {
    expect(jaroWinkler("commit", "comit")).toBeGreaterThan(0.9);
  });
});
