import { describe, expect, it } from "vitest";
import { commonIndent, expandTabs, imageName, layout, styleFor, THEMES, toLines, type Options, type Span } from "./model";

const night = THEMES[0];
const plain = (lines: ReturnType<typeof toLines>) => lines.map((l) => l.map((r) => r.text).join(""));

describe("code image model", () => {
  it("picks a colour and weight for a token", () => {
    expect(styleFor("tok-keyword", night)).toEqual({ color: night.tokens.keyword, bold: true, italic: false });
    expect(styleFor("tok-comment", night)).toEqual({ color: night.tokens.comment, bold: false, italic: true });
    // The more specific class wins.
    expect(styleFor("tok-variableName tok-function tok-definition", night).color).toBe(night.tokens.function);
    expect(styleFor("tok-variableName", night).color).toBe(night.text);
    expect(styleFor("", night).color).toBe(night.text);
    // A sparse theme falls back to its text colour.
    expect(styleFor("tok-number", THEMES[3]).color).toBe(THEMES[3].text);
  });

  it("expands tabs to tab stops and finds shared indentation", () => {
    expect(expandTabs("\ta\tb", 4)).toBe("    a   b");
    expect(expandTabs("ab\tc", 4)).toBe("ab  c");
    expect(commonIndent(["    a", "      b", "", "    c"])).toBe(4);
    expect(commonIndent(["", "  "])).toBe(0);
  });

  it("splits highlighted text into lines of runs", () => {
    const text = "const x = 1;\n// note\nreturn x;";
    const spans: Span[] = [
      { from: 0, to: 5, classes: "tok-keyword" },
      { from: 10, to: 11, classes: "tok-number" },
      { from: 13, to: 20, classes: "tok-comment" },
      { from: 21, to: 27, classes: "tok-keyword" },
    ];
    const lines = toLines(text, spans, night);
    expect(plain(lines)).toEqual(["const x = 1;", "// note", "return x;"]);
    expect(lines[0].map((r) => r.text)).toEqual(["const", " x = ", "1", ";"]);
    expect(lines[0][0]).toMatchObject({ color: night.tokens.keyword, bold: true });
    expect(lines[0][2].color).toBe(night.tokens.number);
    expect(lines[1]).toEqual([{ text: "// note", color: night.tokens.comment, italic: true }]);
    expect(lines[2][0].text).toBe("return");
  });

  it("handles a span over several lines, an offset, CRLF and dedent", () => {
    const block = toLines("a /* x\ny */ b", [{ from: 2, to: 11, classes: "tok-comment" }], night);
    expect(block[0].map((r) => r.text)).toEqual(["a ", "/* x"]);
    expect(block[1].map((r) => r.text)).toEqual(["y */", " b"]);
    // The selection starts at offset 100 of the document.
    const shifted = toLines("let a", [{ from: 100, to: 103, classes: "tok-keyword" }], night, { base: 100 });
    expect(shifted[0][0]).toMatchObject({ text: "let", bold: true });
    const crlf = toLines("if x\r\n  y", [{ from: 0, to: 2, classes: "tok-keyword" }, { from: 8, to: 9, classes: "tok-number" }], night);
    expect(plain(crlf)).toEqual(["if x", "  y"]);
    expect(crlf[1][1].color).toBe(night.tokens.number);
    expect(plain(toLines("\n    a\n\tb\n      c\n\n", [], night, { dedent: true, tabSize: 4 }))).toEqual(["a", "b", "  c"]);
    expect(plain(toLines("", [], night))).toEqual([""]);
  });

  it("joins neighbouring runs of the same style", () => {
    const lines = toLines("ab", [{ from: 0, to: 1, classes: "tok-string" }, { from: 1, to: 2, classes: "tok-string" }], night);
    expect(lines[0]).toHaveLength(1);
  });

  it("sizes the image from the longest line and the options", () => {
    const base: Options = { fontSize: 20, lineNumbers: false, firstLine: 1, margin: 0, windowChrome: false, title: "" };
    const lines = toLines("x".repeat(40) + "\nshort", [], night);
    const a = layout(lines, 12, base);
    expect(a.width).toBe(26 * 2 + 40 * 12);
    expect(a.height).toBe(26 + 2 * 31 + 26);
    expect(a.gutterWidth).toBe(0);
    const b = layout(lines, 12, { ...base, lineNumbers: true, firstLine: 98, margin: 40, windowChrome: true });
    // Lines 98 and 99: two digits plus spacing.
    expect(b.gutterWidth).toBe(48);
    expect(b.width).toBe(a.width + 48 + 80);
    expect(b.headerHeight).toBe(52);
    expect(b.window).toMatchObject({ x: 40, y: 40 });
    expect(b.codeX).toBe(40 + 26 + 48);
    // Very short code still gets a window wide enough to look like one.
    expect(layout(toLines("x", [], night), 12, base).width).toBe(26 * 2 + 24 * 12);
  });

  it("names the image after the file and lines", () => {
    expect(imageName("C:\\src\\my app.ts", 10, 5)).toBe("my-app.ts-L10-14.png");
    expect(imageName("/a/b.py", 3, 1)).toBe("b.py-L3.png");
    expect(imageName(null, 1, 2)).toBe("code-L1-2.png");
  });
});
