import { describe, expect, it } from "vitest";
import { findDefinition, findReferences, unusedBindings } from "./references";

describe("findReferences", () => {
  it("finds every occurrence of a local variable including its declaration", () => {
    const src = "function f() {\n  let total = 0;\n  total = total + 1;\n  return total;\n}\n";
    const offset = src.indexOf("return total") + "return ".length;
    const refs = findReferences(src, "javascript", offset);
    // declaration + two in the middle line + return = 4
    expect(refs.length).toBe(4);
    expect(refs.some((r) => r.isDeclaration)).toBe(true);
  });

  it("does not include property accesses with the same name", () => {
    const src = "const value = 1;\nconst o = { value: 2 };\nconsole.log(o.value, value);\n";
    const offset = src.indexOf("const value") + "const ".length;
    const refs = findReferences(src, "javascript", offset);
    // The `value` decl, and the bare `value` in console.log — but NOT o.value or the key.
    expect(refs.every((r) => src.slice(Math.max(0, r.from - 2), r.from).indexOf(".") === -1)).toBe(true);
    expect(refs.length).toBe(2);
  });

  it("respects shadowing across scopes", () => {
    const src = "const x = 1;\nfunction f() {\n  const x = 2;\n  return x;\n}\n";
    const innerUse = src.indexOf("return x") + "return ".length;
    const refs = findReferences(src, "javascript", innerUse);
    // Only the inner declaration and its use, not the outer x.
    expect(refs.length).toBe(2);
    expect(refs.every((r) => r.from > src.indexOf("function"))).toBe(true);
  });
});

describe("findDefinition", () => {
  it("resolves a use to its declaration offset", () => {
    const src = "const answer = 42;\nconsole.log(answer);\n";
    const use = src.indexOf("log(answer)") + "log(".length;
    const def = findDefinition(src, "javascript", use);
    expect(def?.offset).toBe(src.indexOf("answer"));
    expect(def?.kind).toBe("const");
  });
});

describe("unusedBindings", () => {
  it("reports a declared-but-never-read local", () => {
    const src = "function f() {\n  const used = 1;\n  const dead = 2;\n  return used;\n}\n";
    const unused = unusedBindings(src, "javascript").map((u) => u.binding.name);
    expect(unused).toContain("dead");
    expect(unused).not.toContain("used");
  });

  it("ignores leading-underscore names", () => {
    const src = "function f(_ignored, kept) {\n  return 1;\n}\n";
    const unused = unusedBindings(src, "javascript").map((u) => u.binding.name);
    expect(unused).not.toContain("_ignored");
    expect(unused).toContain("kept");
  });
});
