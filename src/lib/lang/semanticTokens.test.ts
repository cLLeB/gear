import { describe, expect, it } from "vitest";
import { classifySemanticTokens, groupByType } from "./semanticTokens";

function typeOf(src: string, needle: string, lang = "javascript"): string | undefined {
  const at = src.indexOf(needle);
  const tokens = classifySemanticTokens(src, lang);
  return tokens.find((t) => t.from === at)?.type;
}

describe("classifySemanticTokens", () => {
  it("classifies a property access as property", () => {
    const src = "console.log(x);\n";
    expect(typeOf(src, "log")).toBe("function"); // log( is a call
    const src2 = "const v = obj.field;\n";
    expect(typeOf(src2, "field")).toBe("property");
  });

  it("classifies a type annotation position as type", () => {
    const src = "let a: MyType = init;\n";
    expect(typeOf(src, "MyType", "typescript")).toBe("type");
  });

  it("classifies `new X` as a class", () => {
    const src = "const e = new Widget();\n";
    expect(typeOf(src, "Widget")).toBe("class");
  });

  it("classifies a resolved parameter as parameter", () => {
    const src = "function f(count) {\n  return count + 1;\n}\n";
    const use = src.indexOf("return count") + "return ".length;
    const tokens = classifySemanticTokens(src, "javascript");
    expect(tokens.find((t) => t.from === use)?.type).toBe("parameter");
  });

  it("marks the declaration site with a declaration modifier", () => {
    const src = "const answer = 42;\n";
    const declAt = src.indexOf("answer");
    const token = classifySemanticTokens(src, "javascript").find((t) => t.from === declAt);
    expect(token?.type).toBe("variable");
    expect(token?.modifiers).toContain("declaration");
  });

  it("classifies a bare call as function with a call modifier", () => {
    const src = "function run() {}\nrun();\n";
    const callAt = src.lastIndexOf("run");
    const token = classifySemanticTokens(src, "javascript").find((t) => t.from === callAt);
    expect(token?.type).toBe("function");
    expect(token?.modifiers).toContain("call");
  });

  it("emits string, number and comment tokens", () => {
    const src = "const n = 1; // note\nconst s = \"hi\";\n";
    const grouped = groupByType(classifySemanticTokens(src, "javascript"));
    expect(grouped.get("number")).toBeDefined();
    expect(grouped.get("string")).toBeDefined();
    expect(grouped.get("comment")).toBeDefined();
  });
});
