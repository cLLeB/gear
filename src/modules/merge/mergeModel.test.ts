import { describe, expect, it } from "vitest";
import { lineMatches, mergeRegions, operationFrom, regionSpans, renderResult, sidesFromMarkers } from "./mergeModel";

const base = "a\nb\nc\nd\ne\n";

describe("lineMatches", () => {
  it("matches common lines in order", () => {
    expect([...lineMatches(["a", "b", "c"], ["a", "x", "c"])]).toEqual([
      [0, 0],
      [2, 2],
    ]);
    expect(lineMatches([], ["a"]).size).toBe(0);
  });
});

describe("mergeRegions", () => {
  it("auto-merges one-sided and identical changes", () => {
    const ours = "a\nB\nc\nd\ne\n";
    const theirs = "a\nb\nc\nD\ne\nf\n";
    const r = mergeRegions(base, ours, theirs);
    expect(r.filter((x) => x.kind === "change").map((x) => (x.kind === "change" ? x.who : ""))).toEqual(["ours", "theirs", "theirs"]);
    expect(renderResult(r, { ours: "HEAD", theirs: "feature" })).toEqual({ text: "a\nB\nc\nD\ne\nf\n", conflicts: 0 });
    const same = mergeRegions(base, "a\nX\nc\nd\ne\n", "a\nX\nc\nd\ne\n");
    expect(same.find((x) => x.kind === "change")).toMatchObject({ who: "both" });
  });

  it("marks conflicts and resolves them by choice", () => {
    const r = mergeRegions(base, "a\nOURS\nc\nd\ne\n", "a\nTHEIRS\nc\nd\ne\n");
    const unresolved = renderResult(r, { ours: "HEAD", theirs: "feature" });
    expect(unresolved.conflicts).toBe(1);
    expect(unresolved.text).toBe("a\n<<<<<<< HEAD\nOURS\n||||||| base\nb\n=======\nTHEIRS\n>>>>>>> feature\nc\nd\ne\n");
    expect(renderResult(r, { ours: "", theirs: "" }, ["theirs+ours"]).text).toBe("a\nTHEIRS\nOURS\nc\nd\ne\n");
    expect(renderResult(r, { ours: "", theirs: "" }, ["base"]).text).toBe(base);
    expect(regionSpans(r)).toEqual([{ ours: [1, 2], theirs: [1, 2], who: "conflict", conflictIndex: 0 }]);
  });

  it("handles insertions at the same spot and deletions", () => {
    const r = mergeRegions("x\ny\n", "x\nours\ny\n", "x\ntheirs\ny\n");
    expect(renderResult(r, { ours: "o", theirs: "t" }).conflicts).toBe(1);
    const del = mergeRegions(base, "a\nc\nd\ne\n", base);
    expect(renderResult(del, { ours: "o", theirs: "t" }).text).toBe("a\nc\nd\ne\n");
  });

  it("is fast on big files", () => {
    const big = Array.from({ length: 20000 }, (_, i) => `line ${i}`).join("\n");
    const ours = big.replace("line 100\n", "line 100 ours\n");
    const theirs = big.replace("line 19000\n", "line 19000 theirs\n");
    const t = performance.now();
    const out = renderResult(mergeRegions(big, ours, theirs), { ours: "o", theirs: "t" });
    expect(out.conflicts).toBe(0);
    expect(out.text).toContain("line 100 ours\n");
    expect(out.text).toContain("line 19000 theirs\n");
    expect(performance.now() - t).toBeLessThan(2000);
  });
});

describe("markers and state", () => {
  it("recovers sides from a conflicted file", () => {
    const s = sidesFromMarkers("a\n<<<<<<< HEAD\nO\n||||||| base\nB\n=======\nT\n>>>>>>> x\nz")!;
    expect(s).toEqual({ base: "a\nB\nz", ours: "a\nO\nz", theirs: "a\nT\nz", hasBase: true });
    expect(sidesFromMarkers("plain")).toBeNull();
  });

  it("detects the operation", () => {
    expect(operationFrom(new Set(["HEAD", "MERGE_HEAD"]))).toBe("merge");
    expect(operationFrom(new Set(["rebase-merge"]))).toBe("rebase");
    expect(operationFrom(new Set(["HEAD"]))).toBeNull();
  });
});
