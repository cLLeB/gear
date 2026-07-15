import { describe, expect, it } from "vitest";
import { escapeRegExp, literalRegExp } from "./escapeRegExp";

describe("escapeRegExp", () => {
  it("escapes metacharacters", () => {
    expect(escapeRegExp("a.b*c+")).toBe("a\\.b\\*c\\+");
  });

  it("produces a pattern that matches literally", () => {
    expect(literalRegExp("a.b").test("a.b")).toBe(true);
    expect(literalRegExp("a.b").test("axb")).toBe(false);
  });

  it("supports flags", () => {
    expect(literalRegExp("FOO", "i").test("foo")).toBe(true);
  });
});
