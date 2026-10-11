import { describe, expect, it } from "vitest";
import { alignLines, findOperator, pickOperator } from "./align";

describe("alignLines", () => {
  it("aligns assignments", () => {
    expect(alignLines(["const a = 1;", "const longer = 2;", "let x=3;"])).toEqual([
      "const a      = 1;",
      "const longer = 2;",
      "let x        = 3;",
    ]);
  });

  it("aligns object keys after the colon", () => {
    expect(alignLines(["  id: 1,", "  name: 'a:b',", "  createdAt: now,"])).toEqual([
      "  id:        1,",
      "  name:      'a:b',",
      "  createdAt: now,",
    ]);
  });

  it("aligns arrows and trailing comments, leaving other lines", () => {
    expect(alignLines(["a => 1", "bbb => 2", "// note"])).toEqual(["a   => 1", "bbb => 2", "// note"]);
    expect(alignLines(["x = 1 // one", "yy = 2 // two"], "//")).toEqual(["x = 1  // one", "yy = 2 // two"]);
  });
});

describe("operator detection", () => {
  it("ignores comparison operators and quoted text", () => {
    expect(findOperator("if (a == b) c = 1", "=")).toBe(14);
    expect(findOperator(`s = "a=b"`, "=")).toBe(2);
    expect(findOperator("a::b: c", ":")).toBe(4);
  });

  it("picks the most common operator", () => {
    expect(pickOperator(["a = 1", "b = 2", "c: 3"])).toBe("=");
    expect(pickOperator(["a: 1", "b: 2"])).toBe(":");
    expect(pickOperator(["plain", "text"])).toBeNull();
  });
});
