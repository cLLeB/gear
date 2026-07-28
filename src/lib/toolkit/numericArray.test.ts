import { describe, expect, it } from "vitest";
import { range, windows, zip } from "./numericArray";

describe("numericArray", () => {
  it("builds ascending ranges", () => {
    expect(range(1, 5)).toEqual([1, 2, 3, 4]);
    expect(range(4)).toEqual([0, 1, 2, 3]);
  });

  it("builds descending ranges", () => {
    expect(range(3, 0, -1)).toEqual([3, 2, 1]);
  });

  it("zips to the shorter length", () => {
    expect(zip([1, 2, 3], ["a", "b"])).toEqual([
      [1, "a"],
      [2, "b"],
    ]);
  });

  it("produces sliding windows", () => {
    expect(windows([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
  });
});
