import { describe, expect, it } from "vitest";
import { compactRelativeTime } from "./compactRelativeTime";

describe("compactRelativeTime", () => {
  const now = 1_700_000_000_000;

  it("reads recent as now", () => {
    expect(compactRelativeTime(now - 2_000, now)).toBe("now");
  });

  it("formats past times", () => {
    expect(compactRelativeTime(now - 3 * 60_000, now)).toBe("3m ago");
    expect(compactRelativeTime(now - 2 * 3_600_000, now)).toBe("2h ago");
  });

  it("formats future times", () => {
    expect(compactRelativeTime(now + 5 * 86_400_000, now)).toBe("in 5d");
  });

  it("accepts Date objects", () => {
    expect(compactRelativeTime(new Date(now - 60_000), new Date(now))).toBe("1m ago");
  });
});
