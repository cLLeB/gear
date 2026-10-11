import { describe, expect, it } from "vitest";
import { CODECS, base64, base64url, hex, html, jsonString, unicodeEscape, url } from "./encoding";

describe("codecs round-trip", () => {
  const samples = ["hello", "héllo wörld ✓", "emoji 🚀 and 日本語", 'quotes "x" & <tag>', ""];
  for (const [id, { codec }] of Object.entries(CODECS)) {
    it(id, () => {
      for (const s of samples) expect(codec.decode(codec.encode(s))).toBe(s);
    });
  }
});

describe("specific encodings", () => {
  it("base64 handles UTF-8 and rejects garbage", () => {
    expect(base64.encode("✓")).toBe("4pyT");
    expect(base64.decode("4pyT")).toBe("✓");
    expect(() => base64.decode("not base64!")).toThrow();
    expect(base64url.encode("??>")).toBe("Pz8-");
  });

  it("url decodes + as space", () => {
    expect(url.decode("a+b%20c")).toBe("a b c");
  });

  it("html decodes named and numeric entities", () => {
    expect(html.decode("&lt;b&gt; &amp; &#x1F680; &#169; &hellip; &unknown;")).toBe("<b> & 🚀 © … &unknown;");
  });

  it("json string accepts quoted or bare input", () => {
    expect(jsonString.encode('a"b\n')).toBe('a\\"b\\n');
    expect(jsonString.decode('"a\\tb"')).toBe("a\tb");
  });

  it("unicode escapes use surrogate pairs and decode \\u{…} and \\x", () => {
    expect(unicodeEscape.encode("é🚀")).toBe("\\u00e9\\ud83d\\ude80");
    expect(unicodeEscape.decode("\\u{1F680}\\x41")).toBe("🚀A");
  });

  it("hex tolerates separators and 0x", () => {
    expect(hex.encode("Hi")).toBe("4869");
    expect(hex.decode("0x48:69")).toBe("Hi");
    expect(() => hex.decode("abc")).toThrow();
  });
});
