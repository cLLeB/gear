import { describe, expect, it } from "vitest";
import { fuzzyScore } from "./fuzzyScore";

describe("fuzzyScore", () => {
  it("matches an ordered subsequence", () => {
    const m = fuzzyScore("gcm", "git commit");
    expect(m.score).toBeGreaterThan(0);
    expect(m.positions.length).toBe(3);
  });

  it("returns zero when characters are out of order", () => {
    expect(fuzzyScore("zzz", "abc").score).toBe(0);
  });

  it("scores consecutive matches higher than scattered", () => {
    const tight = fuzzyScore("com", "commit");
    const loose = fuzzyScore("com", "c-o-m-x");
    expect(tight.score).toBeGreaterThan(loose.score);
  });

  it("rewards word-boundary starts", () => {
    const boundary = fuzzyScore("fb", "foo bar");
    const inside = fuzzyScore("fb", "foobar");
    expect(boundary.score).toBeGreaterThan(inside.score);
  });

  it("treats empty query as a trivial match", () => {
    expect(fuzzyScore("", "anything").score).toBe(1);
  });
});
