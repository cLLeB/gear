import { describe, expect, it } from "vitest";
import { indentBlock, langName, parseNameList, stripFence, testFileFor, truncateMiddle } from "./prompts";

describe("ai tool helpers", () => {
  it("strips fences", () => {
    expect(stripFence("```ts\nconst a = 1;\n```")).toBe("const a = 1;");
    expect(stripFence("Here you go:\n```py\nx = 1\n```\nEnjoy")).toBe("x = 1");
    expect(stripFence("  plain  ")).toBe("plain");
  });

  it("names languages and test files", () => {
    expect(langName("/a/b.tsx", "")).toBe("TypeScript (React)");
    expect(langName("/a/b.unknown", "elixir")).toBe("elixir");
    expect(testFileFor("/src/util.ts")).toBe("/src/util.test.ts");
    expect(testFileFor("/pkg/parse.py")).toBe("/pkg/test_parse.py");
    expect(testFileFor("C:\\x\\main.go")).toBe("C:\\x\\main_test.go");
  });

  it("parses name lists and indents blocks", () => {
    expect(parseNameList("1. `userCount`\n- totalUsers\n* not valid name\nuserCount")).toEqual(["userCount", "totalUsers"]);
    expect(indentBlock("/**\n * Hi\n */\n", "  ")).toBe("  /**\n   * Hi\n   */");
  });

  it("truncates the middle", () => {
    const t = truncateMiddle("a".repeat(100) + "b".repeat(100), 50);
    expect(t.startsWith("a".repeat(30))).toBe(true);
    expect(t.endsWith("b".repeat(20))).toBe(true);
    expect(t).toContain("150 characters omitted");
  });
});
