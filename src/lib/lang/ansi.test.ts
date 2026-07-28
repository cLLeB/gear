import { describe, expect, it } from "vitest";
import { parseAnsi, stripAnsi } from "./ansi";

describe("stripAnsi", () => {
  it("removes SGR sequences", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m plain")).toBe("red plain");
  });

  it("removes cursor and OSC sequences", () => {
    expect(stripAnsi("a\x1b[2Kb\x1b]0;title\x07c")).toBe("abc");
  });
});

describe("parseAnsi", () => {
  it("splits into styled segments", () => {
    const segs = parseAnsi("\x1b[31mred\x1b[0m normal");
    expect(segs).toEqual([
      { text: "red", style: { fg: 1 } },
      { text: " normal", style: {} },
    ]);
  });

  it("combines multiple attributes in one sequence", () => {
    const [seg] = parseAnsi("\x1b[1;4;32mgo\x1b[0m");
    expect(seg.style).toEqual({ bold: true, underline: true, fg: 2 });
  });

  it("carries style across text until reset", () => {
    const segs = parseAnsi("\x1b[1mbold \x1b[31mred-bold\x1b[0m end");
    expect(segs[0].style).toEqual({ bold: true });
    expect(segs[1].style).toEqual({ bold: true, fg: 1 });
    expect(segs[2].style).toEqual({});
  });

  it("parses 256-color codes", () => {
    const [seg] = parseAnsi("\x1b[38;5;208mx");
    expect(seg.style.fg).toBe(208);
  });

  it("parses 24-bit truecolor codes", () => {
    const [seg] = parseAnsi("\x1b[38;2;255;128;0mx");
    expect(seg.style.fg).toEqual({ r: 255, g: 128, b: 0 });
  });

  it("maps bright foreground colors", () => {
    const [seg] = parseAnsi("\x1b[91mbright");
    expect(seg.style.fg).toBe(9);
  });

  it("clears a specific attribute without a full reset", () => {
    const segs = parseAnsi("\x1b[1;31mx\x1b[22my");
    expect(segs[0].style).toEqual({ bold: true, fg: 1 });
    expect(segs[1].style).toEqual({ fg: 1 }); // bold cleared, color kept
  });

  it("returns a single plain segment when there are no codes", () => {
    expect(parseAnsi("just text")).toEqual([{ text: "just text", style: {} }]);
  });
});
