import { describe, expect, it } from "vitest";
import { bracketDepthAt, computeBracketPairs, matchingBracket } from "./bracketPairs";

describe("computeBracketPairs", () => {
  it("pairs nested brackets with increasing depth", () => {
    const src = "a([{}])";
    const { pairs, unmatched } = computeBracketPairs(src, "javascript");
    expect(unmatched).toEqual([]);
    // ( at 1, [ at 2, { at 3 — depths 0,1,2 respectively.
    const byOpen = new Map(pairs.map((p) => [p.open.char, p.depth]));
    expect(byOpen.get("(")).toBe(0);
    expect(byOpen.get("[")).toBe(1);
    expect(byOpen.get("{")).toBe(2);
  });

  it("ignores brackets inside strings and comments", () => {
    const src = "const s = \"(not a bracket]\"; // ]}) also ignored\n";
    const { unmatched } = computeBracketPairs(src, "javascript");
    expect(unmatched).toEqual([]);
  });

  it("reports an unmatched opening bracket", () => {
    const { unmatched } = computeBracketPairs("foo(bar", "javascript");
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].reason).toBe("unmatched-open");
    expect(unmatched[0].char).toBe("(");
  });

  it("reports an unmatched closing bracket", () => {
    const { unmatched } = computeBracketPairs("foo)", "javascript");
    expect(unmatched[0].reason).toBe("unmatched-close");
  });

  it("reports a mismatched bracket kind", () => {
    const { unmatched } = computeBracketPairs("[)", "javascript");
    expect(unmatched.some((u) => u.reason === "mismatch" && u.expected === "]")).toBe(true);
  });
});

describe("matchingBracket", () => {
  it("jumps from an opener to its closer and back", () => {
    const src = "fn(a, b)";
    const openOffset = src.indexOf("(");
    const closeOffset = src.indexOf(")");
    expect(matchingBracket(src, "javascript", openOffset)).toBe(closeOffset);
    expect(matchingBracket(src, "javascript", closeOffset)).toBe(openOffset);
  });

  it("returns null when not on a bracket", () => {
    expect(matchingBracket("fn(a)", "javascript", 0)).toBeNull();
  });
});

describe("bracketDepthAt", () => {
  it("counts enclosing pairs at an offset", () => {
    const src = "a(b(c)d)";
    const analysis = computeBracketPairs(src, "javascript");
    const cOffset = src.indexOf("c");
    expect(bracketDepthAt(analysis, cOffset)).toBe(2);
    const dOffset = src.indexOf("d");
    expect(bracketDepthAt(analysis, dOffset)).toBe(1);
  });
});
