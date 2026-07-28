import { describe, expect, it } from "vitest";
import { ansi256ToRgb, rgbToAnsi256 } from "./ansi256";

describe("ansi256", () => {
  it("maps pure white and black", () => {
    expect(rgbToAnsi256({ r: 255, g: 255, b: 255 })).toBe(231);
    expect(rgbToAnsi256({ r: 0, g: 0, b: 0 })).toBe(16);
  });

  it("maps grayscale into the ramp", () => {
    expect(rgbToAnsi256({ r: 128, g: 128, b: 128 })).toBeGreaterThanOrEqual(232);
  });

  it("expands palette codes to rgb", () => {
    expect(ansi256ToRgb(16)).toEqual({ r: 0, g: 0, b: 0 });
    expect(ansi256ToRgb(231)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("round-trips a cube color approximately", () => {
    const rgb = { r: 215, g: 95, b: 0 };
    expect(ansi256ToRgb(rgbToAnsi256(rgb))).toEqual(rgb);
  });
});
