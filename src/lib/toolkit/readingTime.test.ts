import { describe, expect, it } from "vitest";
import { readingTime, wordCount } from "./readingTime";

describe("readingTime", () => {
  it("counts words", () => {
    expect(wordCount("the quick brown fox")).toBe(4);
    expect(wordCount("   ")).toBe(0);
  });

  it("estimates minutes and label", () => {
    const words = Array.from({ length: 400 }, () => "word").join(" ");
    const rt = readingTime(words, 200);
    expect(rt.words).toBe(400);
    expect(rt.text).toBe("2 min read");
  });

  it("labels short text", () => {
    expect(readingTime("just a few words").text).toBe("< 1 min read");
    expect(readingTime("").text).toBe("0 min read");
  });
});
