import { describe, expect, it } from "vitest";
import { applyWorkspaceEdit, computeRename, prepareRename } from "./rename";

describe("prepareRename", () => {
  it("returns the range and placeholder on an identifier", () => {
    const src = "const total = 1;\n";
    const at = src.indexOf("total");
    const prep = prepareRename(src, "javascript", at);
    expect("error" in prep).toBe(false);
    if (!("error" in prep)) expect(prep.placeholder).toBe("total");
  });

  it("errors when the cursor is on a keyword, not an identifier", () => {
    const src = "const total = 1;\n";
    // offset 0 sits on the `const` keyword — not renameable.
    expect("error" in prepareRename(src, "javascript", 0)).toBe(true);
  });
});

describe("computeRename", () => {
  it("renames every occurrence of a local, skipping properties", () => {
    const src = "function f() {\n  let count = 0;\n  count = count + 1;\n  return obj.count;\n}\n";
    const at = src.indexOf("let count") + "let ".length;
    const result = computeRename(src, "javascript", at, "total");
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    // decl + two uses = 3 edits; obj.count property is NOT renamed.
    expect(result.edits).toHaveLength(3);
    const applied = applyWorkspaceEdit(src, result);
    expect(applied).toContain("obj.count"); // property untouched
    expect(applied).toContain("total = total + 1");
  });

  it("does not touch a shadowing binding in another scope", () => {
    const src = "const x = 1;\nfunction f() {\n  const x = 2;\n  return x;\n}\n";
    const outerAt = src.indexOf("const x") + "const ".length;
    const result = computeRename(src, "javascript", outerAt, "y");
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    const applied = applyWorkspaceEdit(src, result);
    // Outer renamed to y; inner x untouched.
    expect(applied).toContain("const y = 1;");
    expect(applied).toContain("const x = 2;");
    expect(applied).toContain("return x;");
  });

  it("rejects an invalid identifier", () => {
    const src = "const a = 1;\n";
    const at = src.indexOf("a");
    const result = computeRename(src, "javascript", at, "1bad");
    expect("error" in result).toBe(true);
  });

  it("rejects a reserved keyword", () => {
    const src = "const a = 1;\n";
    const at = src.indexOf("a");
    const result = computeRename(src, "javascript", at, "return");
    expect("error" in result).toBe(true);
  });

  it("rejects a same-scope collision", () => {
    const src = "function f() {\n  let a = 1;\n  let b = 2;\n  return a + b;\n}\n";
    const at = src.indexOf("let a") + "let ".length;
    const result = computeRename(src, "javascript", at, "b");
    expect("error" in result).toBe(true);
  });

  it("is a no-op when the name is unchanged", () => {
    const src = "const a = 1;\n";
    const at = src.indexOf("a");
    const result = computeRename(src, "javascript", at, "a");
    expect("error" in result).toBe(false);
    if (!("error" in result)) expect(result.edits).toEqual([]);
  });
});
