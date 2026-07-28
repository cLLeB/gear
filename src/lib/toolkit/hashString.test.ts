import { describe, expect, it } from "vitest";
import { djb2, fnv1a, hashHex } from "./hashString";

describe("hashString", () => {
  it("is stable and unsigned", () => {
    expect(djb2("hello")).toBe(djb2("hello"));
    expect(djb2("hello")).toBeGreaterThanOrEqual(0);
  });

  it("differs for different inputs", () => {
    expect(djb2("a")).not.toBe(djb2("b"));
    expect(fnv1a("a")).not.toBe(fnv1a("b"));
  });

  it("matches known FNV-1a vector", () => {
    // FNV-1a 32-bit of empty string is the offset basis.
    expect(fnv1a("")).toBe(0x811c9dc5);
  });

  it("produces 8-char hex", () => {
    expect(hashHex("gear")).toMatch(/^[0-9a-f]{8}$/);
  });
});
