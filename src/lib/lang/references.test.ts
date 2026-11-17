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

describe("unusedBindings with string interpolation", () => {
  const names = (src: string, lang: string) => unusedBindings(src, lang).map((u) => u.binding.name);

  it("counts reads inside JS/TS template literals", () => {
    expect(names("function f() {\n  const name = 'x';\n  return `hi ${name}`;\n}\n", "javascript")).not.toContain("name");
    expect(names("export function f() {\n  const n = 1;\n  const obj = { a: 1 };\n  return `n=${n + 1} ${obj.a}`;\n}\n", "typescript")).toEqual([]);
  });

  it("does not count member names or plain strings in JS", () => {
    expect(names("function f() {\n  const a = 1;\n  return `${x.a}` + '${a}';\n}\n", "javascript")).toContain("a");
  });

  it("counts reads inside Python f-strings but not plain strings", () => {
    expect(names('def f():\n    name = "x"\n    return f"hi {name!r:>10}"\n', "python")).not.toContain("name");
    expect(names('def f():\n    name = "x"\n    return "hi {name}"\n', "python")).toContain("name");
    expect(names('def f():\n    name = "x"\n    return f"{{name}}"\n', "python")).toContain("name");
  });

  it("counts Rust inline format arguments", () => {
    expect(names('fn main() {\n    let total = 1;\n    let lens = 2;\n    println!("{total} {lens:?}");\n}\n', "rust")).toEqual([]);
    expect(names('fn main() {\n    let width = 1;\n    println!("{{width}}");\n}\n', "rust")).toContain("width");
  });
});

describe("unusedBindings scope edge cases", () => {
  const names = (src: string, lang: string) => unusedBindings(src, lang).map((u) => u.binding.name);

  it("keeps the function scope across a TS object type in the parameters", () => {
    const src = "export function f(o: { a: number }) {\n  const dead = 1;\n  return o.a;\n}\n";
    expect(names(src, "typescript")).toEqual(["dead"]);
  });

  it("resolves parameters used in later default values", () => {
    expect(names("export function f(a, b = a * 2) {\n  return b;\n}\n", "javascript")).toEqual([]);
  });

  it("does not leak expression-bodied arrow params onto the next block", () => {
    const src = "export function f(xs, c) {\n  const ys = xs.map((x) => x * 2);\n  if (c) {\n    const x = 1;\n  }\n  return ys;\n}\n";
    expect(names(src, "javascript")).toEqual(["x"]);
  });

  it("binds Rust pattern variables, not the enum variant", () => {
    const src = "fn f(o: Option<i32>) -> i32 {\n    if let Some(v) = o { v } else { 0 }\n}\n";
    expect(names(src, "rust")).toEqual([]);
    expect(names("fn f(o: Option<i32>) {\n    if let Some(v) = o {}\n}\n", "rust")).toEqual(["v"]);
    expect(names("fn f(p: (i32, i32)) -> i32 {\n    let (a, b) = p;\n    a\n}\n", "rust")).toEqual(["b"]);
  });

  it("leaves module-level Python names alone but still reports dead locals", () => {
    const src = "LIMIT = 3\ndef helper():\n    unused_local = 1\n    return 2\n";
    expect(names(src, "python")).toEqual(["unused_local"]);
  });
});
