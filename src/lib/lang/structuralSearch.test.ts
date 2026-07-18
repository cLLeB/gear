import { describe, expect, it } from "vitest";
import { structuralReplace, structuralSearch } from "./structuralSearch";

describe("structuralSearch", () => {
  it("matches a call and binds the argument metavariable", () => {
    const src = "console.log(foo);\nconsole.log(a + b);";
    const matches = structuralSearch(src, "javascript", "console.log($X)");
    expect(matches).toHaveLength(2);
    expect(matches[0].bindings.get("$X")?.text).toBe("foo");
    expect(matches[1].bindings.get("$X")?.text).toBe("a + b");
  });

  it("captures a balanced argument list as a single binding", () => {
    const src = "foo(bar(1, 2), 3)";
    const [match] = structuralSearch(src, "javascript", "foo($ARGS)");
    expect(match.bindings.get("$ARGS")?.text).toBe("bar(1, 2), 3");
  });

  it("treats a repeated metavariable as a back-reference", () => {
    expect(structuralSearch("x = a + a", "javascript", "$X + $X")).toHaveLength(1);
    expect(structuralSearch("x = a + b", "javascript", "$X + $X")).toHaveLength(0);
  });

  it("ignores formatting differences when matching", () => {
    const src = "if(ready){go();}";
    const matches = structuralSearch(src, "javascript", "if ($C) { $BODY }");
    expect(matches).toHaveLength(1);
    expect(matches[0].bindings.get("$C")?.text).toBe("ready");
  });

  it("returns no matches when the pattern is absent", () => {
    expect(structuralSearch("const x = 1;", "javascript", "await $P")).toEqual([]);
  });
});

describe("structuralReplace", () => {
  it("rewrites matches using captured bindings", () => {
    const src = "var a = 1;\nvar b = 2;";
    const out = structuralReplace(src, "javascript", "var $X = $Y;", "let $X = $Y;");
    expect(out).toBe("let a = 1;\nlet b = 2;");
  });

  it("can reorder captured groups", () => {
    const src = "swap(first, second)";
    const out = structuralReplace(src, "javascript", "swap($A, $B)", "swap($B, $A)");
    expect(out).toBe("swap(second, first)");
  });

  it("leaves non-matching source untouched", () => {
    const src = "const x = 1;";
    expect(structuralReplace(src, "javascript", "var $X = $Y;", "let $X = $Y;")).toBe(src);
  });
});
