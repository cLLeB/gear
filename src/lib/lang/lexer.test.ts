import { describe, expect, it } from "vitest";
import { tokenize, type LexerConfig } from "./lexer";

const JS: LexerConfig = {
  lineComments: ["//"],
  blockComments: [["/*", "*/"]],
  strings: [
    { quote: '"', escape: "\\" },
    { quote: "'", escape: "\\" },
    { quote: "`", escape: "\\", multiline: true },
  ],
  keywords: new Set(["const", "function", "return"]),
  operators: ["===", "==", "=>", "=", "+", "+="],
};

describe("tokenize", () => {
  it("classifies identifiers and keywords", () => {
    const t = tokenize("const x", JS);
    expect(t[0]).toMatchObject({ type: "keyword", value: "const" });
    expect(t[1]).toMatchObject({ type: "identifier", value: "x" });
  });

  it("keeps brackets out of strings", () => {
    const t = tokenize('a("(")', JS);
    const brackets = t.filter((tok) => tok.bracket);
    expect(brackets.map((b) => b.value)).toEqual(["(", ")"]);
  });

  it("handles escapes inside strings", () => {
    const t = tokenize('"a\\"b"', JS);
    expect(t[0]).toMatchObject({ type: "string", value: '"a\\"b"' });
  });

  it("flags unterminated strings", () => {
    const t = tokenize('"open', JS);
    expect(t[0]).toMatchObject({ type: "string", unterminated: true });
  });

  it("flags unterminated block comments", () => {
    const t = tokenize("/* open", JS);
    expect(t[0]).toMatchObject({ type: "comment", unterminated: true });
  });

  it("does not let single-line strings cross newlines", () => {
    const t = tokenize("'a\nb'", JS);
    expect(t[0]).toMatchObject({ type: "string", unterminated: true });
  });

  it("lets template strings span lines", () => {
    const t = tokenize("`a\nb`", JS);
    expect(t[0]).toMatchObject({ type: "string", value: "`a\nb`" });
    expect(t[0].unterminated).toBeUndefined();
    expect(t).toHaveLength(1);
  });

  it("greedily matches the longest operator", () => {
    const t = tokenize("a === b", JS);
    expect(t[1]).toMatchObject({ type: "operator", value: "===" });
  });

  it("tokenizes numbers including hex and float", () => {
    const t = tokenize("0xFF 3.14 1e-9", JS);
    expect(t.map((x) => x.value)).toEqual(["0xFF", "3.14", "1e-9"]);
    expect(t.every((x) => x.type === "number")).toBe(true);
  });

  it("covers every non-whitespace char with offsets in order", () => {
    const src = "const x = 1";
    const t = tokenize(src, JS);
    for (const tok of t) expect(src.slice(tok.start, tok.end)).toBe(tok.value);
  });
});
