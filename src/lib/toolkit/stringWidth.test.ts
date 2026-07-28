import { describe, expect, it } from "vitest";
import { stringWidth } from "./stringWidth";

const ESC = String.fromCharCode(27);

describe("stringWidth", () => {
  it("counts ascii as one cell each", () => {
    expect(stringWidth("hello")).toBe(5);
  });

  it("counts CJK as two cells", () => {
    expect(stringWidth("世界")).toBe(4);
  });

  it("ignores ANSI escapes", () => {
    expect(stringWidth(`${ESC}[31mred${ESC}[0m`)).toBe(3);
  });

  it("ignores combining marks", () => {
    expect(stringWidth("é")).toBe(1);
  });
});
