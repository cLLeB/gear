import { describe, expect, it } from "vitest";
import { clockToSeconds, secondsToClock } from "./secondsToClock";

describe("secondsToClock", () => {
  it("formats under an hour", () => {
    expect(secondsToClock(65)).toBe("1:05");
  });

  it("formats with hours", () => {
    expect(secondsToClock(3725)).toBe("1:02:05");
  });

  it("can force hours", () => {
    expect(secondsToClock(5, { forceHours: true })).toBe("0:00:05");
  });

  it("clamps negatives", () => {
    expect(secondsToClock(-10)).toBe("0:00");
  });

  it("parses back", () => {
    expect(clockToSeconds("1:02:05")).toBe(3725);
    expect(clockToSeconds("bad")).toBeNull();
  });
});
