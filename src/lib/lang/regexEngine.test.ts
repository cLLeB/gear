import { describe, expect, it } from "vitest";
import { compileRegex, regexMatch } from "./regexEngine";

describe("regexEngine", () => {
  it("matches literals and concatenation", () => {
    expect(regexMatch("abc", "abc")).toBe(true);
    expect(regexMatch("abc", "abd")).toBe(false);
  });

  it("handles alternation", () => {
    expect(regexMatch("cat|dog", "dog")).toBe(true);
    expect(regexMatch("cat|dog", "cow")).toBe(false);
  });

  it("handles star, plus, and optional", () => {
    expect(regexMatch("ab*c", "ac")).toBe(true);
    expect(regexMatch("ab*c", "abbbc")).toBe(true);
    expect(regexMatch("ab+c", "ac")).toBe(false);
    expect(regexMatch("colou?r", "color")).toBe(true);
    expect(regexMatch("colou?r", "colour")).toBe(true);
  });

  it("handles grouping with quantifiers", () => {
    expect(regexMatch("(ab)+", "ababab")).toBe(true);
    expect(regexMatch("(ab)+", "aba")).toBe(false);
  });

  it("handles the wildcard", () => {
    expect(regexMatch("a.c", "axc")).toBe(true);
    expect(regexMatch("a.c", "a\nc")).toBe(false);
  });

  it("handles character classes and ranges", () => {
    expect(regexMatch("[a-z]+", "hello")).toBe(true);
    expect(regexMatch("[a-z]+", "Hello")).toBe(false);
    expect(regexMatch("[^0-9]+", "abc")).toBe(true);
  });

  it("handles escape classes", () => {
    expect(regexMatch("\\d+", "12345")).toBe(true);
    expect(regexMatch("\\w+", "a_1")).toBe(true);
    expect(regexMatch("\\d+", "12a")).toBe(false);
  });

  it("matches a realistic pattern", () => {
    const re = compileRegex("[a-z]+@[a-z]+\\.[a-z]+");
    expect(re.test("dev@example.com")).toBe(true);
    expect(re.test("nope")).toBe(false);
  });

  it("does not choke on pathological patterns (no backtracking)", () => {
    // This would blow up a backtracking engine; the NFA handles it linearly.
    expect(regexMatch("(a+)+b", "aaaaaaaaaaaaaaaaaaaac")).toBe(false);
  });

  it("throws on invalid syntax", () => {
    expect(() => compileRegex("(ab")).toThrow();
    expect(() => compileRegex("[a-z")).toThrow();
  });
});
