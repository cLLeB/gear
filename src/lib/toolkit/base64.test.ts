import { describe, expect, it } from "vitest";
import { decodeBase64, encodeBase64 } from "./base64";

describe("base64", () => {
  it("encodes ascii", () => {
    expect(encodeBase64("hello")).toBe("aGVsbG8=");
  });

  it("round-trips unicode", () => {
    const s = "héllo 世界 🚀";
    expect(decodeBase64(encodeBase64(s))).toBe(s);
  });

  it("decodes ascii", () => {
    expect(decodeBase64("aGVsbG8=")).toBe("hello");
  });
});
