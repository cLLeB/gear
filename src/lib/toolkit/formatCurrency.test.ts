import { describe, expect, it } from "vitest";
import { formatCurrency } from "./formatCurrency";

describe("formatCurrency", () => {
  it("formats USD", () => {
    expect(formatCurrency(1234.5, { locale: "en-US", currency: "USD" })).toBe("$1,234.50");
  });

  it("respects digit overrides", () => {
    expect(formatCurrency(10, { locale: "en-US", currency: "USD", digits: 0 })).toBe("$10");
  });

  it("handles other currencies", () => {
    expect(formatCurrency(5, { locale: "en-GB", currency: "GBP" })).toContain("£");
  });
});
