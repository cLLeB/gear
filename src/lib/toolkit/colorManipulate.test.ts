import { describe, expect, it } from "vitest";
import { darken, gradient, lighten, mix } from "./colorManipulate";

describe("colorManipulate", () => {
  it("lightens toward white", () => {
    expect(lighten("#000000", 1)).toBe("#ffffff");
  });

  it("darkens toward black", () => {
    expect(darken("#ffffff", 1)).toBe("#000000");
  });

  it("mixes halfway", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("returns endpoints of a gradient", () => {
    const g = gradient("#000000", "#ffffff", 3);
    expect(g).toHaveLength(3);
    expect(g[0]).toBe("#000000");
    expect(g[2]).toBe("#ffffff");
  });
});
