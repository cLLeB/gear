import { describe, expect, it } from "vitest";
import { enclosingHeaders, indentLevels } from "./visualAids";

describe("indentLevels", () => {
  it("splits leading whitespace by unit", () => {
    expect(indentLevels("    x", 2)).toEqual([
      { from: 0, to: 2, level: 0 },
      { from: 2, to: 4, level: 1 },
    ]);
    expect(indentLevels("\t\tx", 4).map((r) => r.level)).toEqual([0, 1]);
    expect(indentLevels("x", 2)).toEqual([]);
  });
});

describe("enclosingHeaders", () => {
  it("finds enclosing blocks by indentation", () => {
    const src = ["class A {", "  method() {", "    if (x) {", "      doThing();", "", "      other();", "    }", "  }", "}"];
    expect(enclosingHeaders((n) => src[n - 1], 6)).toEqual([1, 2, 3]);
  });

  it("handles python and markdown", () => {
    const py = ["def f():", "    for x in y:", "        print(x)"];
    expect(enclosingHeaders((n) => py[n - 1], 3)).toEqual([1, 2]);
    const md = ["# Title", "text", "## Part", "### Sub", "body"];
    expect(enclosingHeaders((n) => md[n - 1], 5)).toEqual([1, 3, 4]);
  });
});

describe("navigation history", async () => {
  const { shouldRecord } = await import("./navHistory");
  it("records file switches and big jumps only", () => {
    expect(shouldRecord(null, { path: "a", line: 1 })).toBe(false);
    expect(shouldRecord({ path: "a", line: 1 }, { path: "a", line: 5 })).toBe(false);
    expect(shouldRecord({ path: "a", line: 1 }, { path: "a", line: 40 })).toBe(true);
    expect(shouldRecord({ path: "a", line: 1 }, { path: "b", line: 1 })).toBe(true);
  });
});
