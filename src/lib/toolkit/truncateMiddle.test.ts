import { describe, expect, it } from "vitest";
import { truncateMiddle } from "./truncateMiddle";

describe("truncateMiddle", () => {
  it("leaves short strings untouched", () => {
    expect(truncateMiddle("short", 10)).toBe("short");
  });

  it("cuts the middle out", () => {
    expect(truncateMiddle("/usr/local/bin/node", 11)).toBe("/usr/…/node");
  });

  it("keeps the result within max length", () => {
    const out = truncateMiddle("a".repeat(100), 20);
    expect(out.length).toBe(20);
  });

  it("supports custom ellipsis", () => {
    expect(truncateMiddle("abcdefgh", 5, { ellipsis: "..." })).toBe("a...h");
  });

  it("handles degenerate max", () => {
    expect(truncateMiddle("abc", 0)).toBe("");
  });
});
