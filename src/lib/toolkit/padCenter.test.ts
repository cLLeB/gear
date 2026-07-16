import { describe, expect, it } from "vitest";
import { padCenter } from "./padCenter";

describe("padCenter", () => {
  it("centers text", () => {
    expect(padCenter("hi", 6)).toBe("  hi  ");
  });

  it("favours the right for odd padding", () => {
    expect(padCenter("hi", 5)).toBe(" hi  ");
  });

  it("supports a fill character", () => {
    expect(padCenter("x", 5, "*")).toBe("**x**");
  });

  it("returns unchanged when too wide", () => {
    expect(padCenter("hello", 3)).toBe("hello");
  });
});
