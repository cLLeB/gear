import { describe, expect, it } from "vitest";
import { parseDuration } from "./parseDuration";

describe("parseDuration", () => {
  it("parses compound durations", () => {
    expect(parseDuration("2h30m")).toBe(2 * 3_600_000 + 30 * 60_000);
  });

  it("parses milliseconds", () => {
    expect(parseDuration("500ms")).toBe(500);
  });

  it("tolerates spaces and words", () => {
    expect(parseDuration("1 hr 15 min")).toBe(3_600_000 + 15 * 60_000);
  });

  it("parses fractional values", () => {
    expect(parseDuration("1.5s")).toBe(1500);
  });

  it("returns null when nothing matches", () => {
    expect(parseDuration("soon")).toBeNull();
  });
});
