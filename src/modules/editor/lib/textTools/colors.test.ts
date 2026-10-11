import { describe, expect, it } from "vitest";
import { findColors, formatColor, nextFormat, parseCssColor } from "./colors";

describe("parseCssColor", () => {
  it("parses legacy and modern syntaxes", () => {
    expect(parseCssColor("rgb(255 0 0 / 50%)")).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
    expect(parseCssColor("rgba(0, 128, 255, 0.25)")).toEqual({ r: 0, g: 128, b: 255, a: 0.25 });
    expect(parseCssColor("hsl(120deg 100% 50%)")).toMatchObject({ r: 0, g: 255, b: 0, a: 1 });
    expect(parseCssColor("rgb(100% 0% 0%)")).toMatchObject({ r: 255, g: 0, b: 0 });
    expect(parseCssColor("#f80")).toMatchObject({ r: 255, g: 136, b: 0 });
  });
});

describe("findColors", () => {
  it("finds literals with offsets and formats", () => {
    const text = "a { color: #ff8800; background: rgba(0,0,0,.5); border: hsl(0 0% 50%) }";
    const found = findColors(text, 100);
    expect(found.map((f) => [f.text, f.format])).toEqual([
      ["#ff8800", "hex"],
      ["rgba(0,0,0,.5)", "rgb"],
      ["hsl(0 0% 50%)", "hsl"],
    ]);
    expect(found[0].from).toBe(100 + text.indexOf("#ff8800"));
  });

  it("skips hashes inside identifiers and URLs", () => {
    expect(findColors("see page.html#abc and issue a#123")).toEqual([]);
  });
});

describe("formatColor", () => {
  const orange = { r: 255, g: 136, b: 0, a: 1 };
  it("converts between notations", () => {
    expect(formatColor(orange, "hex")).toBe("#ff8800");
    expect(formatColor(orange, "rgb")).toBe("rgb(255, 136, 0)");
    expect(formatColor(orange, "hsl")).toBe("hsl(32, 100%, 50%)");
    expect(formatColor({ ...orange, a: 0.5 }, "rgb")).toBe("rgba(255, 136, 0, 0.5)");
  });
  it("cycles formats", () => {
    expect(nextFormat("hex")).toBe("rgb");
    expect(nextFormat("hsl")).toBe("hex");
  });
});
