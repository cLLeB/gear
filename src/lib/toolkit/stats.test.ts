import { describe, expect, it } from "vitest";
import { mean, median, percentile, stddev, sum, variance } from "./stats";

describe("stats", () => {
  const data = [2, 4, 4, 4, 5, 5, 7, 9];

  it("computes sum and mean", () => {
    expect(sum(data)).toBe(40);
    expect(mean(data)).toBe(5);
  });

  it("computes median", () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("computes variance and stddev", () => {
    expect(variance(data)).toBe(4);
    expect(stddev(data)).toBe(2);
  });

  it("computes percentiles by interpolation", () => {
    expect(percentile([1, 2, 3, 4], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4], 100)).toBe(4);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
  });

  it("returns NaN for empty input", () => {
    expect(mean([])).toBeNaN();
  });
});
