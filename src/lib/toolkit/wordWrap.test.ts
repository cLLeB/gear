import { describe, expect, it } from "vitest";
import { wordWrap } from "./wordWrap";

describe("wordWrap", () => {
  it("wraps on word boundaries", () => {
    expect(wordWrap("the quick brown fox", { width: 10 })).toBe(
      "the quick\nbrown fox",
    );
  });

  it("breaks long words when asked", () => {
    expect(wordWrap("supercalifragilistic", { width: 5 })).toBe(
      "super\ncalif\nragil\nistic",
    );
  });

  it("preserves existing newlines", () => {
    expect(wordWrap("a\nb", { width: 80 })).toBe("a\nb");
  });
});
