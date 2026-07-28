import { describe, expect, it } from "vitest";
import { IncrementalTokenizer, lexLine } from "./incrementalLexer";
import { getLanguageSpec } from "./languages";
import { tokenize } from "./lexer";

const JS = getLanguageSpec("javascript")!.lexer;

function tokenTriples(tokens: { type: string; value: string; start: number }[]) {
  return tokens.map((t) => `${t.type}:${t.value}@${t.start}`);
}

describe("lexLine", () => {
  it("tokenizes a simple code line and reports code out-state", () => {
    const { tokens, outState } = lexLine("const x = 1;", { kind: "code" }, JS);
    expect(outState.kind).toBe("code");
    expect(tokens.find((t) => t.value === "const")?.type).toBe("keyword");
    expect(tokens.find((t) => t.value === "1")?.type).toBe("number");
  });

  it("carries an unterminated block comment into the next line", () => {
    const { outState } = lexLine("code(); /* open", { kind: "code" }, JS);
    expect(outState.kind).toBe("block-comment");
  });

  it("resumes and closes a block comment carried in", () => {
    const { tokens, outState } = lexLine(" still comment */ code()", { kind: "block-comment", close: "*/" }, JS);
    expect(outState.kind).toBe("code");
    expect(tokens[0].type).toBe("comment");
    expect(tokens.some((t) => t.value === "code")).toBe(true);
  });

  it("carries an unterminated template string", () => {
    const { outState } = lexLine("const t = `line one", { kind: "code" }, JS);
    expect(outState.kind).toBe("string");
  });
});

describe("IncrementalTokenizer", () => {
  it("produces the same absolute tokens as whole-document tokenize", () => {
    const src = "function f() {\n  return `a${b}c`;\n}\n// tail\n";
    const inc = new IncrementalTokenizer(src, JS);
    expect(tokenTriples(inc.allTokens())).toEqual(tokenTriples(tokenize(src, JS)));
  });

  it("re-lexes only the edited line when state does not change", () => {
    const src = "let a = 1;\nlet b = 2;\nlet c = 3;\nlet d = 4;\n";
    const inc = new IncrementalTokenizer(src, JS);
    const relexed = inc.applyEdit(1, 2, ["let b = 20;"]);
    expect(relexed).toBe(1); // only the changed line
    expect(inc.allTokens().some((t) => t.value === "20")).toBe(true);
  });

  it("propagates state forward until reconvergence when a block comment opens", () => {
    const src = "a();\nb();\nc();\nd();\n";
    const inc = new IncrementalTokenizer(src, JS);
    // Open a block comment on line 0 that closes on line 2's original text? No —
    // it stays open; every following line is now comment until we converge.
    const relexed = inc.applyEdit(0, 1, ["a(); /* open"]);
    expect(relexed).toBeGreaterThan(1);
    // Lines after the opener should now be comment tokens.
    expect(inc.lineCache[1].inState.kind).toBe("block-comment");
  });

  it("stops re-lexing once state reconverges with the cached tail", () => {
    // A block comment closes on line 1; lines 2+ are plain code in both the old
    // and the new document, so editing line 0 should reconverge quickly.
    const src = "/* c1\nstill */\nx();\ny();\nz();\n";
    const inc = new IncrementalTokenizer(src, JS);
    const relexed = inc.applyEdit(0, 1, ["// c1"]); // turn it into a line comment
    // Only line 0 and line 1 need re-lexing; line 2 already began in code.
    expect(relexed).toBeLessThan(inc.lineCount);
    expect(inc.lineCache[2].inState.kind).toBe("code");
    expect(inc.allTokens().some((t) => t.value === "z")).toBe(true);
  });

  it("handles inserting multiple lines", () => {
    const src = "top();\nbottom();\n";
    const inc = new IncrementalTokenizer(src, JS);
    inc.applyEdit(1, 1, ["middle1();", "middle2();"]);
    const values = inc.allTokens().map((t) => t.value);
    expect(values).toContain("middle1");
    expect(values).toContain("middle2");
    expect(values).toContain("bottom");
  });
});
