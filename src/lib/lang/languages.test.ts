import { describe, expect, it } from "vitest";
import { getLanguageSpec, isAnalyzable, supportedLanguages } from "./languages";
import { tokenize } from "./lexer";

describe("languages", () => {
  it("resolves base specs", () => {
    expect(getLanguageSpec("javascript")?.id).toBe("javascript");
    expect(getLanguageSpec("python")?.braceBlocks).toBe(false);
  });

  it("resolves aliases to a base spec", () => {
    expect(getLanguageSpec("typescript")?.id).toBe("javascript");
    expect(getLanguageSpec("cpp")?.id).toBe("c");
  });

  it("reports analyzability", () => {
    expect(isAnalyzable("rust")).toBe(true);
    expect(isAnalyzable("brainfuck")).toBe(false);
  });

  it("provides a lexer config that tokenizes its language", () => {
    const spec = getLanguageSpec("javascript")!;
    const t = tokenize("const x = 1 // c", spec.lexer);
    expect(t[0]).toMatchObject({ type: "keyword", value: "const" });
    expect(t[t.length - 1]).toMatchObject({ type: "comment" });
  });

  it("lists supported languages", () => {
    expect(supportedLanguages()).toContain("json");
  });
});
