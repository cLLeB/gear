import { describe, expect, it } from "vitest";
import { crc32, crc32Hex } from "./crc32";

describe("crc32", () => {
  it("matches known vectors", () => {
    // Standard CRC-32 of "123456789" is 0xCBF43926.
    expect(crc32("123456789")).toBe(0xcbf43926);
  });

  it("hashes the empty string to zero", () => {
    expect(crc32("")).toBe(0);
  });

  it("produces 8-char hex", () => {
    expect(crc32Hex("The quick brown fox jumps over the lazy dog")).toBe("414fa339");
  });
});
