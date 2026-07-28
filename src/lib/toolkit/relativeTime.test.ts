import { describe, expect, it } from "vitest";
import { relativeTime } from "./relativeTime";

describe("relativeTime", () => {
  const now = 1_700_000_000_000;

  it("formats seconds ago", () => {
    expect(relativeTime(now - 5_000, now, "en")).toBe("5 seconds ago");
  });

  it("formats minutes in the future", () => {
    expect(relativeTime(now + 120_000, now, "en")).toBe("in 2 minutes");
  });

  it("formats days ago", () => {
    expect(relativeTime(now - 3 * 86_400_000, now, "en")).toBe("3 days ago");
  });

  it("accepts Date objects", () => {
    expect(relativeTime(new Date(now - 3_600_000), new Date(now), "en")).toBe(
      "1 hour ago",
    );
  });
});
