import { describe, expect, it } from "vitest";
import { fuzzyFilter, fuzzyMatch, fuzzyMatches } from "./fuzzy";

describe("fuzzyMatches", () => {
  it("recognizes subsequences case-insensitively", () => {
    expect(fuzzyMatches("gc", "getContext")).toBe(true);
    expect(fuzzyMatches("xyz", "getContext")).toBe(false);
    expect(fuzzyMatches("", "anything")).toBe(true);
  });
});

describe("fuzzyMatch", () => {
  it("returns null when not a subsequence", () => {
    expect(fuzzyMatch("zzz", "abc")).toBeNull();
  });

  it("reconstructs the matched positions", () => {
    const res = fuzzyMatch("gc", "getContext")!;
    expect(res).not.toBeNull();
    // 'g' at 0, 'C' at 3 (camelCase boundary is preferred).
    expect(res.positions).toEqual([0, 3]);
  });

  it("prefers camelCase boundary matches over earlier scattered ones", () => {
    // "cb" should match the boundary C+B in "camelBoundary" not c...b scattered.
    const boundary = fuzzyMatch("cb", "camelBoundary")!;
    expect(boundary.positions[0]).toBe(0); // c
    expect(boundary.positions[1]).toBe(5); // B
  });

  it("scores consecutive matches higher than gapped ones", () => {
    const consecutive = fuzzyMatch("cont", "context")!.score;
    const gapped = fuzzyMatch("cont", "c_o_n_t_ext")!.score;
    expect(consecutive).toBeGreaterThan(gapped);
  });

  it("scores a boundary match higher than a mid-word match", () => {
    const boundary = fuzzyMatch("f", "my_file")!.score; // f after underscore
    const midword = fuzzyMatch("f", "affix")!.score; // f mid-word
    expect(boundary).toBeGreaterThan(midword);
  });
});

describe("fuzzyFilter", () => {
  it("ranks the closest match first", () => {
    const items = ["genericController", "getContext", "gitClone"];
    const ranked = fuzzyFilter("gc", items, (s) => s);
    expect(ranked[0].item).toBe("gitClone");
    expect(ranked.map((r) => r.item)).not.toContain(undefined);
  });

  it("excludes non-matches", () => {
    const ranked = fuzzyFilter("zzz", ["abc", "def"], (s) => s);
    expect(ranked).toEqual([]);
  });

  it("breaks ties toward the shorter target", () => {
    const ranked = fuzzyFilter("ab", ["abxxxxxx", "ab"], (s) => s);
    expect(ranked[0].item).toBe("ab");
  });
});
