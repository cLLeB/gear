import { describe, expect, it } from "vitest";
import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl } from "./color";

describe("color", () => {
  it("parses shorthand and full hex", () => {
    expect(hexToRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("#336699")).toEqual({ r: 51, g: 102, b: 153 });
  });

  it("rejects invalid hex", () => {
    expect(hexToRgb("#xyz")).toBeNull();
  });

  it("serialises to hex", () => {
    expect(rgbToHex({ r: 51, g: 102, b: 153 })).toBe("#336699");
  });

  it("round-trips rgb<->hsl", () => {
    const rgb = { r: 51, g: 102, b: 153 };
    const back = hslToRgb(rgbToHsl(rgb));
    expect(back.r).toBeCloseTo(rgb.r, -1);
    expect(back.g).toBeCloseTo(rgb.g, -1);
    expect(back.b).toBeCloseTo(rgb.b, -1);
  });

  it("computes pure red hsl", () => {
    expect(rgbToHsl({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, l: 50 });
  });
});
