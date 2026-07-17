import { describe, expect, it } from "vitest";
import { formatDocument, formatToString } from "./formatter";

describe("formatDocument / formatToString", () => {
  it("indents nested blocks by structural depth", () => {
    const messy = "function f() {\nif (x) {\ny();\n}\n}\n";
    const expected = "function f() {\n  if (x) {\n    y();\n  }\n}\n";
    expect(formatToString(messy, "javascript")).toBe(expected);
  });

  it("dedents lines that start with a closing bracket", () => {
    const messy = "obj = {\na: 1,\n};\n";
    const expected = "obj = {\n  a: 1,\n};\n";
    expect(formatToString(messy, "javascript")).toBe(expected);
  });

  it("strips trailing whitespace", () => {
    const messy = "const a = 1;   \n";
    expect(formatToString(messy, "javascript")).toBe("const a = 1;\n");
  });

  it("does not reindent inside multi-line template literals", () => {
    const src = "const t = `\n      keep this indentation\n`;\n";
    // The interior line of the template must be preserved exactly.
    const out = formatToString(src, "javascript");
    expect(out).toContain("      keep this indentation");
  });

  it("does not touch braces inside strings", () => {
    const messy = "if (a) {\nconst s = \"}{\";\n}\n";
    const out = formatToString(messy, "javascript");
    expect(out).toBe("if (a) {\n  const s = \"}{\";\n}\n");
  });

  it("supports tab indentation", () => {
    const messy = "function f() {\nreturn 1;\n}\n";
    const out = formatToString(messy, "javascript", { useTabs: true });
    expect(out).toBe("function f() {\n\treturn 1;\n}\n");
  });

  it("supports a custom indent size", () => {
    const messy = "function f() {\nreturn 1;\n}\n";
    const out = formatToString(messy, "javascript", { indentSize: 4 });
    expect(out).toBe("function f() {\n    return 1;\n}\n");
  });

  it("produces no edits for already-formatted code", () => {
    const clean = "function f() {\n  return 1;\n}\n";
    expect(formatDocument(clean, "javascript").edits).toEqual([]);
  });

  it("normalizes blank lines to empty (no trailing spaces)", () => {
    const messy = "a();\n   \nb();\n";
    expect(formatToString(messy, "javascript")).toBe("a();\n\nb();\n");
  });
});
