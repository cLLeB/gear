import { describe, expect, it } from "vitest";
import { applyTransform, expandSnippet, parseSnippet } from "./snippets";

describe("expandSnippet", () => {
  it("places a bare tabstop and reports its position", () => {
    const { text, tabStops } = expandSnippet("console.log($1)");
    expect(text).toBe("console.log()");
    expect(tabStops).toEqual([{ index: 1, ranges: [{ from: 12, to: 12 }] }]);
  });

  it("expands a placeholder with default text and covers it with a range", () => {
    const { text, tabStops } = expandSnippet("for (const ${1:item} of ${2:items}) {}");
    expect(text).toBe("for (const item of items) {}");
    expect(text.slice(tabStops[0].ranges[0].from, tabStops[0].ranges[0].to)).toBe("item");
    expect(text.slice(tabStops[1].ranges[0].from, tabStops[1].ranges[0].to)).toBe("items");
  });

  it("mirrors a tabstop used more than once into multiple ranges", () => {
    const { text, tabStops } = expandSnippet("${1:name} = ${1:name}");
    expect(text).toBe("name = name");
    expect(tabStops[0].index).toBe(1);
    expect(tabStops[0].ranges).toHaveLength(2);
  });

  it("orders $0 (final cursor) after the numbered tabstops", () => {
    const { tabStops } = expandSnippet("if ($1) {\n  $0\n}");
    expect(tabStops.map((t) => t.index)).toEqual([1, 0]);
  });

  it("expands a choice to its first option and records the option list", () => {
    const { text, tabStops } = expandSnippet("access: ${1|public,private,protected|}");
    expect(text).toBe("access: public");
    expect(tabStops[0].options).toEqual(["public", "private", "protected"]);
  });

  it("substitutes variables from context", () => {
    const { text } = expandSnippet("// @file ${TM_FILENAME}", { variables: { TM_FILENAME: "index.ts" } });
    expect(text).toBe("// @file index.ts");
  });

  it("uses a variable default when the variable is unset", () => {
    const { text } = expandSnippet("${TM_SELECTED_TEXT:placeholder}", {});
    expect(text).toBe("placeholder");
  });

  it("treats an escaped dollar as a literal", () => {
    const { text, tabStops } = expandSnippet("price = \\$1");
    expect(text).toBe("price = $1");
    expect(tabStops).toEqual([]);
  });
});

describe("applyTransform / variable transforms", () => {
  it("strips a file extension via a transform", () => {
    const { text } = expandSnippet("class ${TM_FILENAME/(.*)\\..+$/$1/}", {
      variables: { TM_FILENAME: "widget.ts" },
    });
    expect(text).toBe("class widget");
  });

  it("applies case modifiers in the format string", () => {
    const out = applyTransform("hello", { regex: /(.*)/, format: "${1:/upcase}" });
    expect(out).toBe("HELLO");
  });
});

describe("parseSnippet", () => {
  it("produces a node tree with nested placeholder content", () => {
    const nodes = parseSnippet("${1:${2:inner}}");
    expect(nodes[0].kind).toBe("placeholder");
    if (nodes[0].kind === "placeholder") {
      expect(nodes[0].children[0].kind).toBe("placeholder");
    }
  });
});
