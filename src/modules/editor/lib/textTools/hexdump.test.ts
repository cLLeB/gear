import { describe, expect, it } from "vitest";
import { base64ToBytes, describeBytes, hexDump, mimeForPath } from "./hexdump";

describe("hexdump", () => {
  it("formats like xxd", () => {
    expect(hexDump(new TextEncoder().encode("Hello, world!\n"))).toBe("00000000: 4865 6c6c 6f2c 2077 6f72 6c64 210a       Hello, world!.\n");
  });
  it("decodes base64 and guesses mime/encoding", () => {
    expect(Array.from(base64ToBytes("//4A"))).toEqual([255, 254, 0]);
    expect(mimeForPath("a/b.PNG")).toBe("image/png");
    expect(describeBytes(new TextEncoder().encode("a\r\nb\r\n"))).toEqual({ encoding: "UTF-8", eol: "CRLF (Windows)", binary: false });
    expect(describeBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x0a])).encoding).toBe("UTF-8 with BOM");
    expect(describeBytes(new Uint8Array([0x89, 0x50, 0, 1])).binary).toBe(true);
  });
});
