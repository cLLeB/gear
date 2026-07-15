import { describe, expect, it } from "vitest";
import { humanizeDuration } from "./humanizeDuration";

describe("humanizeDuration", () => {
  it("formats multi-unit durations", () => {
    expect(humanizeDuration(3_600_000 * 2 + 60_000 * 3)).toBe("2h 3m");
  });

  it("limits the number of segments", () => {
    expect(humanizeDuration(90_061_000, { maxUnits: 2 })).toBe("1d 1h");
  });

  it("respects the smallest unit", () => {
    expect(humanizeDuration(1_500, { smallest: "ms" })).toBe("1s 500ms");
  });

  it("shows zero at the smallest unit for tiny inputs", () => {
    expect(humanizeDuration(10)).toBe("0s");
  });

  it("handles negatives", () => {
    expect(humanizeDuration(-125_000)).toBe("-2m 5s");
  });
});
