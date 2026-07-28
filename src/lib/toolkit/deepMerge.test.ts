import { describe, expect, it } from "vitest";
import { deepMerge } from "./deepMerge";

describe("deepMerge", () => {
  it("merges nested objects", () => {
    expect(deepMerge({ a: { x: 1 } }, { a: { y: 2 } })).toEqual({
      a: { x: 1, y: 2 },
    });
  });

  it("later sources win on conflict", () => {
    expect(deepMerge({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
  });

  it("replaces arrays rather than merging", () => {
    expect(deepMerge({ a: [1, 2] }, { a: [3] })).toEqual({ a: [3] });
  });

  it("does not mutate inputs", () => {
    const base = { a: { x: 1 } };
    deepMerge(base, { a: { y: 2 } });
    expect(base).toEqual({ a: { x: 1 } });
  });
});
