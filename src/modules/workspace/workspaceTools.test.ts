import { describe, expect, it } from "vitest";
import { expandReplacement, parseFindQuery, replaceInText } from "./replace";
import { parseSymbol, SYMBOL_GREP_PATTERN } from "./symbols";
import { detectTemplates, LICENSES, mergeGitignore } from "./templates";

describe("parseFindQuery / replaceInText", () => {
  it("treats plain text literally with smart case", () => {
    const q = parseFindQuery("a.b");
    expect(q.isRegex).toBe(false);
    expect(q.caseInsensitive).toBe(true);
    expect(replaceInText("a.b axb A.B", q, "$1")).toEqual({ text: "$1 axb $1", count: 2 });
    expect(parseFindQuery("Foo").caseInsensitive).toBe(false);
  });

  it("supports /regex/flags with groups and case operators", () => {
    const q = parseFindQuery("/get_(\\w+)/i");
    expect(replaceInText("get_user GET_item", q, "fetch\\u$1")).toEqual({ text: "fetchUser fetchItem", count: 2 });
    const w = parseFindQuery("/id/w");
    expect(replaceInText("id idx uid id", w, "key").text).toBe("key idx uid key");
  });

  it("expands named groups and $&", () => {
    const m = /(?<word>\w+)/.exec("hello")!;
    expect(expandReplacement("[$&|$<word>|\\U$1\\E!]", m, true)).toBe("[hello|hello|HELLO!]");
  });

  it("skips empty matches", () => {
    expect(replaceInText("abc", parseFindQuery("/x*/"), "-").count).toBe(0);
  });
});

describe("symbols", () => {
  it("parses declarations across languages", () => {
    const cases: [string, string, string][] = [
      ["export async function loadUser(id) {", "loadUser", "function"],
      ["export default class Store {", "Store", "class"],
      ["export const useThing = (a: number) => {", "useThing", "function"],
      ["pub(crate) fn parse_args(", "parse_args", "function"],
      ["impl Display for Point {", "Display for Point", "impl"],
      ["    def handle(self, req):", "handle", "function"],
      ["func (s *Server) Start() error {", "Start", "function"],
      ["type Props = {", "Props", "type"],
      ["public static final class Builder {", "Builder", "class"],
    ];
    const re = new RegExp(SYMBOL_GREP_PATTERN);
    for (const [line, name, kind] of cases) {
      expect(re.test(line), line).toBe(true);
      expect(parseSymbol(line), line).toEqual({ name, kind });
    }
    expect(re.test("const x = 5;")).toBe(false);
  });
});

describe("templates", () => {
  it("detects stacks and merges without duplicates", () => {
    expect(detectTemplates(["package.json", "Cargo.toml", "App.csproj"])).toEqual(["node", "rust", "dotnet"]);
    const { content, added } = mergeGitignore("node_modules/\n", ["node", "macos"]);
    expect(content.startsWith("node_modules/\n\n# Node / JavaScript\nnpm-debug.log*")).toBe(true);
    expect(content).toContain("# macOS\n.DS_Store");
    expect(content.match(/node_modules\//g)).toHaveLength(1);
    expect(added).toBeGreaterThan(5);
    expect(mergeGitignore(content, ["macos"]).added).toBe(0);
  });

  it("fills licence placeholders", () => {
    expect(LICENSES.MIT.text("2026", "Ada")).toContain("Copyright (c) 2026 Ada");
  });
});
