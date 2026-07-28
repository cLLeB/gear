import { describe, expect, it } from "vitest";
import { exponentialMovingAverage, movingAverage } from "./movingAverage";

describe("movingAverage", () => {
  it("averages over the window", () => {
    expect(movingAverage([1, 2, 3, 4], 2)).toEqual([1, 1.5, 2.5, 3.5]);
  });

  it("handles window larger than data", () => {
    expect(movingAverage([2, 4], 5)).toEqual([2, 3]);
  });

  it("throws on bad window", () => {
    expect(() => movingAverage([1], 0)).toThrow();
  });
});

describe("exponentialMovingAverage", () => {
  it("starts at the first value", () => {
    const ema = exponentialMovingAverage([10, 20], 0.5);
    expect(ema[0]).toBe(10);
    expect(ema[1]).toBe(15);
  });

  it("validates alpha", () => {
    expect(() => exponentialMovingAverage([1], 2)).toThrow();
  });
});
