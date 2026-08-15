import { describe, expect, it } from "vitest";
import { parseViewState, pruneViewStates } from "./viewState";

describe("parseViewState", () => {
  it("accepts a well-formed entry", () => {
    expect(parseViewState({ anchor: 5, head: 9, scrollTop: 120, at: 7 })).toEqual(
      { anchor: 5, head: 9, scrollTop: 120, at: 7 },
    );
  });

  it("defaults a missing timestamp so old entries evict first", () => {
    expect(parseViewState({ anchor: 0, head: 0, scrollTop: 0 })?.at).toBe(0);
  });

  it.each([
    ["not an object", 42],
    ["null", null],
    ["a negative offset", { anchor: -1, head: 0, scrollTop: 0 }],
    ["a missing field", { anchor: 1, head: 2 }],
    ["a non-numeric field", { anchor: "1", head: 2, scrollTop: 0 }],
    ["NaN", { anchor: Number.NaN, head: 0, scrollTop: 0 }],
  ])("rejects %s", (_label, input) => {
    expect(parseViewState(input)).toBeNull();
  });
});

describe("pruneViewStates", () => {
  const entry = (at: number) => ({ anchor: 0, head: 0, scrollTop: 0, at });

  it("keeps only the most recently touched entries", () => {
    const out = pruneViewStates(
      { a: entry(1), b: entry(3), c: entry(2) },
      2,
    );
    expect(Object.keys(out).sort()).toEqual(["b", "c"]);
  });

  it("drops malformed entries without losing the good ones", () => {
    const out = pruneViewStates({ a: entry(1), bad: { nope: true } }, 10);
    expect(Object.keys(out)).toEqual(["a"]);
  });

  it("returns an empty map for junk input", () => {
    expect(pruneViewStates(null, 10)).toEqual({});
    expect(pruneViewStates("nope", 10)).toEqual({});
  });

  it("treats a non-positive limit as keeping nothing", () => {
    expect(pruneViewStates({ a: entry(1) }, 0)).toEqual({});
  });
});
