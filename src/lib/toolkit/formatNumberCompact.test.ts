import { describe, expect, it } from "vitest";
import { formatNumberCompact } from "./formatNumberCompact";

describe("formatNumberCompact", () => {
  it("leaves small numbers alone", () => {
    expect(formatNumberCompact(999)).toBe("999");
  });

  it("uses k/M/B suffixes", () => {
    expect(formatNumberCompact(1200)).toBe("1.2k");
    expect(formatNumberCompact(3_400_000)).toBe("3.4M");
    expect(formatNumberCompact(2_000_000_000)).toBe("2B");
  });

  it("handles negatives", () => {
    expect(formatNumberCompact(-1500)).toBe("-1.5k");
  });
});
