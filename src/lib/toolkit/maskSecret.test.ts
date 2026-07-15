import { describe, expect, it } from "vitest";
import { maskSecret } from "./maskSecret";

describe("maskSecret", () => {
  it("keeps head and tail visible", () => {
    const out = maskSecret("sk-1234567890abcdef");
    expect(out.startsWith("sk-1")).toBe(true);
    expect(out.endsWith("cdef")).toBe(true);
    expect(out).toContain("•");
  });

  it("fully masks short secrets", () => {
    expect(maskSecret("abcd")).toBe("••••");
  });

  it("honours custom visibility", () => {
    expect(maskSecret("abcdefghij", { visibleStart: 2, visibleEnd: 2, maskChar: "*" })).toBe(
      "ab******ij",
    );
  });
});
