import { describe, expect, it } from "vitest";
import { mulberry32, sample, shuffle } from "./seededRandom";

describe("seededRandom", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect(a()).toBe(b());
    expect(a()).toBe(b());
  });

  it("produces values in [0, 1)", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("shuffles deterministically and preserves elements", () => {
    const s1 = shuffle([1, 2, 3, 4, 5], mulberry32(7));
    const s2 = shuffle([1, 2, 3, 4, 5], mulberry32(7));
    expect(s1).toEqual(s2);
    expect([...s1].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("samples from the array", () => {
    expect([1, 2, 3]).toContain(sample([1, 2, 3], mulberry32(3)));
    expect(sample([])).toBeUndefined();
  });
});
