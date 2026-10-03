import { describe, expect, it } from "vitest";
import { crc32, hashText, md5 } from "./hash";

describe("md5 (RFC 1321 test suite)", () => {
  it.each([
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["a", "0cc175b9c0f1b6a831c399e269772661"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
    ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
    ["12345678901234567890123456789012345678901234567890123456789012345678901234567890", "57edf4a22be3c955ac49da2e2107b67a"],
  ])("%s", (input, digest) => {
    expect(md5(input)).toBe(digest);
  });

  it("hashes UTF-8 bytes", () => {
    expect(md5("✓")).toBe(md5(new TextEncoder().encode("✓")));
  });
});

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32("123456789")).toBe("cbf43926");
    expect(crc32("")).toBe("00000000");
  });
});

describe("hashText", () => {
  it("computes SHA digests via WebCrypto", async () => {
    expect(await hashText("abc", "SHA-256")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await hashText("abc", "SHA-1")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });
});
