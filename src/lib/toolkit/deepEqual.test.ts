import { describe, expect, it } from "vitest";
import { deepEqual } from "./deepEqual";

describe("deepEqual", () => {
  it("compares primitives", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("a", "b")).toBe(false);
    expect(deepEqual(NaN, NaN)).toBe(true);
  });

  it("compares nested structures", () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: [1] }, { a: [2] })).toBe(false);
  });

  it("compares dates and regexps", () => {
    expect(deepEqual(new Date(0), new Date(0))).toBe(true);
    expect(deepEqual(/x/g, /x/g)).toBe(true);
    expect(deepEqual(/x/g, /x/i)).toBe(false);
  });

  it("distinguishes arrays from objects", () => {
    expect(deepEqual([], {})).toBe(false);
  });
});
