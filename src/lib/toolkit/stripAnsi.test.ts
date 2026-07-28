import { describe, expect, it } from "vitest";
import { hasAnsi, stripAnsi } from "./stripAnsi";

describe("stripAnsi", () => {
  it("removes SGR color codes", () => {
    expect(stripAnsi("[31mred[0m")).toBe("red");
  });

  it("removes cursor movement codes", () => {
    expect(stripAnsi("a[2Kb")).toBe("ab");
  });

  it("leaves plain text untouched", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });

  it("detects presence of ansi", () => {
    expect(hasAnsi("[32mok[0m")).toBe(true);
    expect(hasAnsi("plain")).toBe(false);
  });
});
