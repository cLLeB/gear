import { describe, expect, it } from "vitest";
import { category, clean, codePoints, CONFUSABLES, escapeText, findBidi, graphemeCount, isLatinText, issueOf, normalizations, script, stats, unescapeText } from "./model";

describe("unicode inspector", () => {
  it("never treats plain ASCII as a look-alike", () => {
    for (const key of Object.keys(CONFUSABLES)) expect(key.codePointAt(0)).toBeGreaterThan(0x7f);
  });

  it("describes each code point", () => {
    const [a, e, emoji] = codePoints("aé😀");
    expect(a).toMatchObject({ index: 0, offset: 0, cp: 0x61, hex: "U+0061", category: "Lowercase letter", script: "Latin", utf8: [0x61], utf16: [0x61], issue: null });
    expect(e).toMatchObject({ offset: 1, utf8: [0xc3, 0xa9], script: "Latin" });
    expect(emoji).toMatchObject({ offset: 2, hex: "U+1F600", utf8: [0xf0, 0x9f, 0x98, 0x80], utf16: [0xd83d, 0xde00], category: "Symbol", script: "Common" });
    expect(codePoints("\u200b")[0].name).toBe("ZERO WIDTH SPACE");
    expect(codePoints("x".repeat(50), 10)).toHaveLength(10);
    expect(category("٣")).toBe("Digit");
    expect(script("ж")).toBe("Cyrillic");
    expect(script("\u0301")).toBe("Inherited");
  });

  it("flags invisible, bidi, odd spaces and control characters", () => {
    const kinds = (s: string) => codePoints(s).map((p) => p.issue?.kind ?? null);
    expect(kinds("a\u200bb")).toEqual([null, "invisible", null]);
    expect(kinds("if (x\u202e) {")[5]).toBe("bidi");
    expect(kinds("a\u00a0b")[1]).toBe("space");
    expect(kinds("a\u0007")[1]).toBe("control");
    expect(kinds("a\tb\r\n")).toEqual([null, null, null, null, null]);
    expect(kinds("\ufffd")[0]).toBe("replacement");
    expect(kinds("\ue000")[0]).toBe("private");
    // A joiner inside an emoji sequence is fine.
    expect(kinds("👩\u200d💻").every((k) => k === null)).toBe(true);
    expect(kinds("❤\ufe0f")).toEqual([null, null]);
  });

  it("spots look-alike letters only in Latin text", () => {
    // "pаypal" with a Cyrillic а
    const p = codePoints("pаypal");
    expect(p[1].issue).toMatchObject({ kind: "confusable", replacement: "a" });
    expect(p[1].issue?.message).toContain("Cyrillic");
    expect(isLatinText("pаypal")).toBe(true);
    // Real Russian text is not flagged.
    expect(codePoints("привет мир").some((x) => x.issue)).toBe(false);
    // Typographic dashes and quotes are flagged everywhere.
    expect(issueOf("—", 0x2014, false)).toMatchObject({ kind: "confusable", replacement: "-" });
    expect(issueOf("’", 0x2019, false)?.replacement).toBe("'");
  });

  it("counts what the text is made of", () => {
    const s = stats("héllo wörld\n👩\u200d💻 ok");
    expect(s.lines).toBe(2);
    expect(s.words).toBe(3);
    expect(s.codePoints).toBe([..."héllo wörld\n👩\u200d💻 ok"].length);
    expect(s.utf16Units).toBe("héllo wörld\n👩\u200d💻 ok".length);
    expect(s.utf8Bytes).toBe(new TextEncoder().encode("héllo wörld\n👩\u200d💻 ok").length);
    expect(s.graphemes).toBe(16);
    expect(s.scripts).toEqual([{ script: "Latin", count: 12 }]);
    expect(stats("").lines).toBe(0);
    expect(stats("a\u200b\u200bb").issues.invisible).toBe(2);
    expect(graphemeCount("e\u0301")).toBe(1);
  });

  it("cleans chosen kinds of characters", () => {
    expect(clean("a\u200bb\u00a0c\u202ed", { kinds: new Set(["invisible", "space", "bidi"]) })).toEqual({ text: "ab cd", changed: 3 });
    expect(clean("“hi” — ok", { kinds: new Set(["confusable"]) }).text).toBe('"hi" - ok');
    expect(clean("a\u200bb", { kinds: new Set(["bidi"]) })).toEqual({ text: "a\u200bb", changed: 0 });
    expect(clean("a\u2028b", { kinds: new Set(["space"]) }).text).toBe("a\nb");
  });

  it("locates bidi controls by line and column", () => {
    expect(findBidi("ok\nlet a = 1; /*\u202e } \u2066*/\n")).toEqual([
      { line: 2, column: 14, hex: "U+202E", name: "RIGHT-TO-LEFT OVERRIDE" },
      { line: 2, column: 18, hex: "U+2066", name: "LEFT-TO-RIGHT ISOLATE" },
    ]);
    expect(findBidi("plain")).toEqual([]);
  });

  it("compares normalization forms", () => {
    const n = normalizations("e\u0301ﬁ");
    expect(n.map((x) => [x.form, x.same, x.codePoints])).toEqual([
      ["NFC", false, 2],
      ["NFD", true, 3],
      ["NFKC", false, 3],
      ["NFKD", false, 4],
    ]);
  });

  it("writes and reads escapes", () => {
    expect(escapeText('é"😀\n', "js")).toBe('\\u00E9\\"\\u{1F600}\\n');
    expect(escapeText("é😀", "json")).toBe("\\u00E9\\uD83D\\uDE00");
    expect(escapeText("é😀", "python")).toBe("\\xE9\\U0001F600");
    expect(escapeText("é", "rust")).toBe("\\u{E9}");
    expect(escapeText("é<", "html")).toBe("&#xE9;&#x3C;");
    expect(escapeText("é", "css")).toBe("\\E9 ");
    expect(escapeText("a é", "url")).toBe("a%20%C3%A9");
    for (const s of ["\\u00E9\\uD83D\\uDE00", "\\u{1F600}", "U+00E9", "&#233;&#x1F600;", "%C3%A9", "\\xE9", "\\U0001F600"]) expect(unescapeText(s)).toMatch(/^(é|😀|é😀)$/u);
    expect(unescapeText("a\\nb\\\"")).toBe('a\nb"');
    expect(unescapeText(escapeText("tab\tquote\"é😀", "js"))).toBe("tab\tquote\"é😀");
  });
});
