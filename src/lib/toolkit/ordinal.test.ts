import { describe, expect, it } from "vitest";
import { ordinal, ordinalSuffix } from "./ordinal";

describe("ordinal", () => {
  it("handles 1/2/3", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
  });

  it("handles the teens exception", () => {
    expect(ordinalSuffix(11)).toBe("th");
    expect(ordinalSuffix(12)).toBe("th");
    expect(ordinalSuffix(13)).toBe("th");
  });

  it("handles higher numbers", () => {
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(102)).toBe("102nd");
    expect(ordinal(113)).toBe("113th");
  });
});
