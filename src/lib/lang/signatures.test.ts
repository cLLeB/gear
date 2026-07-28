import { describe, expect, it } from "vitest";
import { extractSignatures, signatureHelpAt } from "./signatures";

describe("extractSignatures", () => {
  it("parses a plain function declaration with typed params", () => {
    const src = "function add(a: number, b: number): number { return a + b; }\n";
    const [sig] = extractSignatures(src, "typescript");
    expect(sig.name).toBe("add");
    expect(sig.params.map((p) => p.name)).toEqual(["a", "b"]);
    expect(sig.params[0].type).toBe("number");
  });

  it("detects optional, default and rest params", () => {
    const src = "function f(a, b?, c = 3, ...rest) {}\n";
    const [sig] = extractSignatures(src, "typescript");
    expect(sig.params[1].optional).toBe(true);
    expect(sig.params[2].hasDefault).toBe(true);
    expect(sig.params[3].rest).toBe(true);
  });

  it("captures arrow-function assignments", () => {
    const src = "const mul = (x, y) => x * y;\n";
    const [sig] = extractSignatures(src, "javascript");
    expect(sig.name).toBe("mul");
    expect(sig.params.map((p) => p.name)).toEqual(["x", "y"]);
  });

  it("parses python defs", () => {
    const src = "def greet(name, greeting):\n    return greeting\n";
    const [sig] = extractSignatures(src, "python");
    expect(sig.name).toBe("greet");
    expect(sig.params.map((p) => p.name)).toEqual(["name", "greeting"]);
  });
});

describe("signatureHelpAt", () => {
  const src = "function add(a, b, c) {}\nadd(1, 2, 3);\n";

  it("reports the active parameter from comma count", () => {
    const call = src.indexOf("add(1");
    const atFirst = signatureHelpAt(src, "javascript", call + "add(".length);
    expect(atFirst?.signature.name).toBe("add");
    expect(atFirst?.activeParameter).toBe(0);

    const atSecond = signatureHelpAt(src, "javascript", src.indexOf("2,") );
    expect(atSecond?.activeParameter).toBe(1);

    const atThird = signatureHelpAt(src, "javascript", src.indexOf("3)"));
    expect(atThird?.activeParameter).toBe(2);
  });

  it("resolves the innermost call when nested", () => {
    const nested = "function outer(a){}\nfunction inner(b){}\nouter(inner(  ));\n";
    const offset = nested.indexOf("inner(  )") + "inner(".length + 1;
    const help = signatureHelpAt(nested, "javascript", offset);
    expect(help?.signature.name).toBe("inner");
  });

  it("returns null outside any call", () => {
    expect(signatureHelpAt(src, "javascript", 0)).toBeNull();
  });
});
