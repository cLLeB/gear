import { describe, expect, it } from "vitest";
import { validateTheme } from "./validateTheme";

function themeWithTerminal(terminal: unknown) {
  return validateTheme({
    id: "t",
    name: "T",
    variants: { dark: { terminal } },
  });
}

describe("validateTheme terminal font overrides", () => {
  it("accepts a well-formed font block", () => {
    const t = themeWithTerminal({
      fontFamily: "Iosevka",
      fontWeight: "600",
      fontSize: 16,
    });
    expect(t.variants.dark?.terminal).toMatchObject({
      fontFamily: "Iosevka",
      fontWeight: "600",
      fontSize: 16,
    });
  });

  it("trims the family and drops blank ones", () => {
    expect(themeWithTerminal({ fontFamily: "  Iosevka  " }).variants.dark?.terminal)
      .toMatchObject({ fontFamily: "Iosevka" });
    expect(
      themeWithTerminal({ fontFamily: "   " }).variants.dark?.terminal?.fontFamily,
    ).toBeUndefined();
  });

  it("skips invalid fields instead of rejecting the theme", () => {
    const t = themeWithTerminal({
      fontFamily: 42,
      fontWeight: "extra-heavy",
      fontSize: 4,
    });
    const terminal = t.variants.dark?.terminal;
    expect(terminal?.fontFamily).toBeUndefined();
    expect(terminal?.fontWeight).toBeUndefined();
    expect(terminal?.fontSize).toBeUndefined();
  });

  it("rejects out-of-range and non-integer sizes", () => {
    for (const fontSize of [7, 33, 14.5, "14"]) {
      expect(
        themeWithTerminal({ fontSize }).variants.dark?.terminal?.fontSize,
      ).toBeUndefined();
    }
    expect(
      themeWithTerminal({ fontSize: 8 }).variants.dark?.terminal?.fontSize,
    ).toBe(8);
    expect(
      themeWithTerminal({ fontSize: 32 }).variants.dark?.terminal?.fontSize,
    ).toBe(32);
  });

  it("accepts every documented weight keyword", () => {
    for (const fontWeight of ["normal", "bold", "100", "500", "900"]) {
      expect(
        themeWithTerminal({ fontWeight }).variants.dark?.terminal?.fontWeight,
      ).toBe(fontWeight);
    }
  });

  it("leaves colour fields untouched by the font additions", () => {
    const t = themeWithTerminal({ background: "#101010", fontSize: 12 });
    expect(t.variants.dark?.terminal).toMatchObject({
      background: "#101010",
      fontSize: 12,
    });
  });
});
