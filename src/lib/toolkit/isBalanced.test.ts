import { describe, expect, it } from "vitest";
import { isBalanced } from "./isBalanced";

describe("isBalanced", () => {
  it("accepts balanced brackets", () => {
    expect(isBalanced("a(b[c]{d})")).toBe(true);
  });

  it("rejects mismatches", () => {
    expect(isBalanced("(]")).toBe(false);
    expect(isBalanced("(()")).toBe(false);
    expect(isBalanced("())")).toBe(false);
  });

  it("ignores brackets in quotes", () => {
    expect(isBalanced('foo("(")')).toBe(true);
  });

  it("flags unterminated quotes", () => {
    expect(isBalanced('foo("')).toBe(false);
  });
});
