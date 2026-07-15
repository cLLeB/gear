import { describe, expect, it } from "vitest";
import { contrastRatio, meetsWcagAA, readableTextColor } from "./contrast";

describe("contrast", () => {
  it("computes max ratio for black on white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });

  it("is 1 for identical colors", () => {
    expect(contrastRatio("#123456", "#123456")).toBeCloseTo(1, 5);
  });

  it("picks readable text color", () => {
    expect(readableTextColor("#ffffff")).toBe("#000000");
    expect(readableTextColor("#000000")).toBe("#ffffff");
  });

  it("checks WCAG AA", () => {
    expect(meetsWcagAA("#000000", "#ffffff")).toBe(true);
    expect(meetsWcagAA("#777777", "#888888")).toBe(false);
  });
});
