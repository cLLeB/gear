import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  darken,
  hslToRgb,
  lighten,
  luminance,
  mix,
  parseColor,
  rgbToHsl,
  toHex,
} from "./color";

describe("parseColor", () => {
  it("parses hex in short and long forms", () => {
    expect(parseColor("#f00")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor("#00ff00")).toEqual({ r: 0, g: 255, b: 0, a: 1 });
    expect(parseColor("#0000ff80")?.a).toBeCloseTo(0.5, 1);
  });

  it("parses rgb() and hsl()", () => {
    expect(parseColor("rgb(255, 128, 0)")).toEqual({ r: 255, g: 128, b: 0, a: 1 });
    expect(parseColor("hsl(0, 100%, 50%)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it("returns null for garbage", () => {
    expect(parseColor("not-a-color")).toBeNull();
  });
});

describe("toHex", () => {
  it("round-trips through parseColor", () => {
    expect(toHex(parseColor("#3a7bd5")!)).toBe("#3a7bd5");
  });

  it("includes alpha when translucent", () => {
    expect(toHex({ r: 255, g: 0, b: 0, a: 0.5 })).toBe("#ff000080");
  });
});

describe("rgbToHsl / hslToRgb", () => {
  it("computes HSL for primaries", () => {
    expect(rgbToHsl(255, 0, 0)).toMatchObject({ h: 0, s: 1, l: 0.5 });
    expect(rgbToHsl(0, 255, 0).h).toBeCloseTo(120, 0);
  });

  it("round-trips a color", () => {
    const hsl = rgbToHsl(58, 123, 213);
    const back = hslToRgb(hsl.h, hsl.s, hsl.l);
    expect(back).toEqual({ r: 58, g: 123, b: 213 });
  });
});

describe("WCAG contrast", () => {
  it("black on white is 21:1", () => {
    const black = parseColor("#000000")!;
    const white = parseColor("#ffffff")!;
    expect(contrastRatio(black, white)).toBeCloseTo(21, 0);
  });

  it("a color against itself is 1:1", () => {
    const c = parseColor("#808080")!;
    expect(contrastRatio(c, c)).toBeCloseTo(1, 5);
  });

  it("white has luminance 1 and black 0", () => {
    expect(luminance(parseColor("#ffffff")!)).toBeCloseTo(1, 5);
    expect(luminance(parseColor("#000000")!)).toBeCloseTo(0, 5);
  });
});

describe("operations", () => {
  it("mixes two colors", () => {
    const purple = mix(parseColor("#ff0000")!, parseColor("#0000ff")!, 0.5);
    expect(purple).toEqual({ r: 128, g: 0, b: 128, a: 1 });
  });

  it("lighten increases luminance, darken decreases it", () => {
    const base = parseColor("#3a7bd5")!;
    expect(luminance(lighten(base, 0.2))).toBeGreaterThan(luminance(base));
    expect(luminance(darken(base, 0.2))).toBeLessThan(luminance(base));
  });
});
