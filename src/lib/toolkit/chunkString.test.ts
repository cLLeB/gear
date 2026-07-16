import { describe, expect, it } from "vitest";
import { chunkString, groupString } from "./chunkString";

describe("chunkString", () => {
  it("splits into fixed-width chunks", () => {
    expect(chunkString("abcdefg", 3)).toEqual(["abc", "def", "g"]);
  });

  it("keeps astral characters intact", () => {
    expect(chunkString("🚀🚀🚀", 1)).toEqual(["🚀", "🚀", "🚀"]);
  });

  it("throws on bad size", () => {
    expect(() => chunkString("x", 0)).toThrow();
  });

  it("groups with a separator", () => {
    expect(groupString("4539148803436467", 4)).toBe("4539 1488 0343 6467");
  });
});
