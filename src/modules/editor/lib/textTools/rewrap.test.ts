import { describe, expect, it } from "vitest";
import { rewrap } from "./rewrap";

describe("rewrap", () => {
  it("re-flows line comments keeping the prefix", () => {
    const lines = [
      "  // This is a long comment that goes on and on past the ruler column for sure",
      "  // and continues here.",
    ];
    expect(rewrap(lines, 40)).toEqual([
      "  // This is a long comment that goes on",
      "  // and on past the ruler column for",
      "  // sure and continues here.",
    ]);
  });

  it("handles block comments, list items and paragraphs", () => {
    const lines = [
      "/**",
      " * Short one.",
      " *",
      " * - item one is quite a lot longer than the column allows",
      " * - item two",
      " */",
    ];
    expect(rewrap(lines, 30)).toEqual([
      "/**",
      " * Short one.",
      " *",
      " * - item one is quite a lot",
      " *   longer than the column",
      " *   allows",
      " * - item two",
      " */",
    ]);
  });

  it("joins short prose lines and wraps Markdown quotes and hash comments", () => {
    expect(rewrap(["a b", "c d"], 80)).toEqual(["a b c d"]);
    expect(rewrap(["> quoted text that wraps here"], 16)).toEqual(["> quoted text", "> that wraps", "> here"]);
    expect(rewrap(["# one two three"], 10)).toEqual(["# one two", "# three"]);
  });

  it("does not split long words", () => {
    expect(rewrap(["https://example.com/a/very/long/url ok"], 10)).toEqual(["https://example.com/a/very/long/url", "ok"]);
  });
});
