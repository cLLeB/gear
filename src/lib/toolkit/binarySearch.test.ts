import { describe, expect, it } from "vitest";
import { binarySearch, insertionIndex } from "./binarySearch";

describe("binarySearch", () => {
  const arr = [1, 3, 5, 7, 9];

  it("finds present values", () => {
    expect(binarySearch(arr, 5)).toBe(2);
    expect(binarySearch(arr, 1)).toBe(0);
    expect(binarySearch(arr, 9)).toBe(4);
  });

  it("returns -1 for absent values", () => {
    expect(binarySearch(arr, 4)).toBe(-1);
  });

  it("computes insertion index", () => {
    expect(insertionIndex(arr, 4)).toBe(2);
    expect(insertionIndex(arr, 0)).toBe(0);
    expect(insertionIndex(arr, 10)).toBe(5);
  });

  it("supports custom comparators", () => {
    const words = ["aa", "bbb", "cccc"];
    expect(binarySearch(words, "bbb", (a, b) => a.length - b.length)).toBe(1);
  });
});
