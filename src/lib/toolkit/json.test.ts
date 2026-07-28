import { describe, expect, it } from "vitest";
import { safeJsonParse, stableStringify } from "./json";

describe("safeJsonParse", () => {
  it("parses valid json", () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
  });

  it("returns fallback on error", () => {
    expect(safeJsonParse("nope", 42)).toBe(42);
  });
});

describe("stableStringify", () => {
  it("sorts keys deterministically", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("produces equal output for equal objects", () => {
    expect(stableStringify({ a: 1, b: { d: 4, c: 3 } })).toBe(
      stableStringify({ b: { c: 3, d: 4 }, a: 1 }),
    );
  });

  it("throws on circular references", () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    expect(() => stableStringify(obj)).toThrow();
  });
});
