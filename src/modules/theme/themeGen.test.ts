import { describe, expect, it } from "vitest";
import { inLightWindow, themeFromAccent } from "./themeGen";
import { auditVariant } from "./contrast";

describe("themeFromAccent", () => {
  it("builds a readable dark and light theme", () => {
    for (const mode of ["dark", "light"] as const) {
      const t = themeFromAccent("#7c3aed", mode);
      const v = t.variants[mode]!;
      expect(v.terminal?.ansi).toHaveLength(16);
      expect(v.colors?.primary).toBe("#7c3aed");
      expect(auditVariant(v).filter((i) => i.pair === "Text on background" || i.pair === "Terminal text")).toEqual([]);
    }
  });
});

describe("inLightWindow", () => {
  it("handles normal and overnight windows", () => {
    expect(inLightWindow("07:00-19:00", new Date(2024, 0, 1, 12, 0))).toBe(true);
    expect(inLightWindow("07:00-19:00", new Date(2024, 0, 1, 20, 0))).toBe(false);
    expect(inLightWindow("22:00-06:00", new Date(2024, 0, 1, 23, 0))).toBe(true);
    expect(inLightWindow("nonsense")).toBeNull();
  });
});
