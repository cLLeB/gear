import { describe, expect, it } from "vitest";
import { buildQuery, groupHits, matchRanges, parseGlobs } from "./query";

describe("find in files query", () => {
  it("escapes plain text and applies the toggles", () => {
    expect(buildQuery({ text: "a.b(c)", matchCase: false, wholeWord: false, regex: false })).toMatchObject({ pattern: "a\\.b\\(c\\)", caseInsensitive: true });
    expect(buildQuery({ text: "foo", matchCase: true, wholeWord: true, regex: false })).toMatchObject({ pattern: "\\b(?:foo)\\b", caseInsensitive: false });
    expect(buildQuery({ text: "fo+|ba[rz]", matchCase: false, wholeWord: false, regex: true })).toMatchObject({ pattern: "fo+|ba[rz]" });
    expect(buildQuery({ text: "", matchCase: false, wholeWord: false, regex: false })).toBeNull();
    expect(buildQuery({ text: "(unclosed", matchCase: false, wholeWord: false, regex: true })).toHaveProperty("error");
  });

  it("groups hits by file in report order", () => {
    const hit = (path: string, line: number) => ({ path, rel: path.split("/").pop() as string, line, text: "x" });
    expect(groupHits([hit("/a/x.ts", 1), hit("/a/y.ts", 4), hit("/a/x.ts", 9)]).map((g) => [g.rel, g.hits.map((h) => h.line)])).toEqual([
      ["x.ts", [1, 9]],
      ["y.ts", [4]],
    ]);
  });

  it("finds match ranges for highlighting", () => {
    const q = buildQuery({ text: "ab", matchCase: false, wholeWord: false, regex: false });
    if (!q || "error" in q) throw new Error("bad query");
    expect(matchRanges("xAbyab", q.matcher)).toEqual([
      [1, 3],
      [4, 6],
    ]);
    const empty = buildQuery({ text: "x*", matchCase: false, wholeWord: false, regex: true });
    if (!empty || "error" in empty) throw new Error("bad query");
    expect(matchRanges("aaa", empty.matcher)).toEqual([]);
  });

  it("reads include globs", () => {
    expect(parseGlobs(" src/**/*.ts , *.md ,, ")).toEqual(["src/**/*.ts", "*.md"]);
  });
});
