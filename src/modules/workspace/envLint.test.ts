import { describe, expect, it } from "vitest";
import { envFilesToLint, lintEnv, parseEnvLines } from "./envLint";

describe("parseEnvLines", () => {
  it("handles export, quotes, comments and multi-line values", () => {
    const text = [
      "# comment",
      "export A=1",
      'B="two words" # trailing',
      "C=three # inline comment",
      'KEY="-----BEGIN',
      "abc",
      '-----END"',
      "D=",
      "not a line",
    ].join("\n");
    const { entries, malformed } = parseEnvLines(text);
    expect(entries.map((e) => [e.key, e.value, e.line])).toEqual([
      ["A", "1", 2],
      ["B", "two words", 3],
      ["C", "three", 4],
      ["KEY", "-----BEGIN\nabc\n-----END", 5],
      ["D", "", 8],
    ]);
    expect(malformed).toEqual([{ line: 9, text: "not a line" }]);
  });
});

describe("lintEnv", () => {
  it("finds duplicates, lowercase keys and unquoted spaces", () => {
    const kinds = lintEnv(".env", "A=1\nA=2\nlower=x\nMSG=hello world\n").map((i) => [i.kind, i.line]);
    expect(kinds).toEqual([
      ["duplicate", 2],
      ["lowercase-key", 3],
      ["unquoted-space", 4],
    ]);
  });

  it("reports drift against the template", () => {
    const issues = lintEnv(".env", "API_URL=\nLOCAL_ONLY=1\n", {
      file: ".env.example",
      text: "API_URL=https://example.com\nAPI_KEY=\n",
    });
    expect(issues.map((i) => [i.kind, i.key])).toEqual([
      ["missing", "API_KEY"],
      ["empty", "API_URL"],
      ["undocumented", "LOCAL_ONLY"],
    ]);
  });
});

describe("envFilesToLint", () => {
  it("picks local env files and the template", () => {
    expect(envFilesToLint([".env", ".env.local", ".env.example", "README.md", ".envrc"])).toEqual({
      files: [".env", ".env.local"],
      template: ".env.example",
    });
  });
});
