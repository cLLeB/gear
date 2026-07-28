import { describe, expect, it } from "vitest";
import { bold, fg256, fgRgb, hyperlink, sgr } from "./ansiStyle";
import { stripAnsi } from "./stripAnsi";

const ESC = String.fromCharCode(27);

describe("ansiStyle", () => {
  it("wraps text in SGR codes", () => {
    expect(sgr("hi", 1, 4)).toBe(`${ESC}[1;4mhi${ESC}[0m`);
  });

  it("bold is code 1", () => {
    expect(bold("x")).toBe(`${ESC}[1mx${ESC}[0m`);
  });

  it("builds 256 and truecolor sequences", () => {
    expect(fg256("x", 200)).toContain("38;5;200");
    expect(fgRgb("x", { r: 1, g: 2, b: 3 })).toContain("38;2;1;2;3");
  });

  it("styled text strips back to plain", () => {
    expect(stripAnsi(bold(fg256("hello", 42)))).toBe("hello");
  });

  it("builds OSC 8 hyperlinks", () => {
    const link = hyperlink("https://x.io", "site");
    expect(link).toContain("https://x.io");
    expect(link).toContain("site");
  });
});
