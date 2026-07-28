import { describe, expect, it } from "vitest";
import { AhoCorasick } from "./ahoCorasick";

describe("AhoCorasick", () => {
  it("finds all overlapping matches (classic ushers example)", () => {
    const ac = new AhoCorasick(["he", "she", "his", "hers"]);
    const found = ac.search("ushers").map((m) => `${m.pattern}@${m.start}`).sort();
    expect(found).toEqual(["he@2", "hers@2", "she@1"].sort());
  });

  it("reports correct start/end offsets", () => {
    const ac = new AhoCorasick(["TODO", "FIXME"]);
    const text = "// TODO: fix\n// FIXME later";
    const matches = ac.search(text);
    expect(matches).toContainEqual({ pattern: "TODO", patternIndex: 0, start: 3, end: 7 });
    const fixme = matches.find((m) => m.pattern === "FIXME")!;
    expect(text.slice(fixme.start, fixme.end)).toBe("FIXME");
  });

  it("finds repeated occurrences of a pattern", () => {
    const ac = new AhoCorasick(["ab"]);
    const matches = ac.search("abcabcab");
    expect(matches.map((m) => m.start)).toEqual([0, 3, 6]);
  });

  it("returns nothing when no pattern is present", () => {
    const ac = new AhoCorasick(["foo", "bar"]);
    expect(ac.search("nothing here")).toEqual([]);
  });

  it("test() reports presence without collecting matches", () => {
    const ac = new AhoCorasick(["secret", "password"]);
    expect(ac.test("my password is weak")).toBe(true);
    expect(ac.test("all clear")).toBe(false);
  });

  it("handles a pattern that is a suffix of another", () => {
    const ac = new AhoCorasick(["ers", "hers"]);
    const found = ac.search("hers").map((m) => m.pattern).sort();
    expect(found).toEqual(["ers", "hers"]);
  });
});
