import { describe, expect, it } from "vitest";
import { offsetInLine } from "./offsetInLine";

describe("offsetInLine", () => {
  const line = { from: 36, to: 48 }; // 12 characters

  it("puts column 1 at the start of the line", () => {
    expect(offsetInLine(line, 1)).toBe(36);
  });

  it("counts columns from 1, like tsc and rustc", () => {
    expect(offsetInLine(line, 5)).toBe(40);
  });

  it("stays at the start without a usable column", () => {
    expect(offsetInLine(line)).toBe(36);
    expect(offsetInLine(line, null)).toBe(36);
    expect(offsetInLine(line, 0)).toBe(36);
    expect(offsetInLine(line, -3)).toBe(36);
    expect(offsetInLine(line, Number.NaN)).toBe(36);
  });

  it("never leaves the line", () => {
    expect(offsetInLine(line, 13)).toBe(48);
    expect(offsetInLine(line, 500)).toBe(48);
  });
});
