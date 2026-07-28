import { describe, expect, it } from "vitest";
import { formatPercent } from "./formatPercent";

describe("formatPercent", () => {
  it("formats a fraction", () => {
    expect(formatPercent(0.42)).toBe("42%");
    expect(formatPercent(0.1234, { digits: 1 })).toBe("12.3%");
  });

  it("supports already-percent input", () => {
    expect(formatPercent(42, { fromPercent: true })).toBe("42%");
  });

  it("adds a sign when asked", () => {
    expect(formatPercent(0.05, { signed: true })).toBe("+5%");
    expect(formatPercent(-0.05, { signed: true })).toBe("-5%");
  });
});
