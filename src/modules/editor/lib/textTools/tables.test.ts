import { describe, expect, it } from "vitest";
import {
  alignDelimited,
  csvToMarkdown,
  formatAllMarkdownTables,
  formatMarkdownTable,
  guessDelimiter,
  markdownToCsv,
  shrinkDelimited,
  splitRow,
} from "./tables";

describe("formatMarkdownTable", () => {
  it("aligns columns and keeps alignment markers", () => {
    const input = "|Name|Qty|Note|\n|:-|-:|:-:|\n|apple|3|fresh|\n|kiwi|12|`a|b`|";
    expect(formatMarkdownTable(input)).toBe(
      [
        "| Name  | Qty | Note  |",
        "| :---- | --: | :---: |",
        "| apple |   3 | fresh |",
        "| kiwi  |  12 | `a|b` |",
      ].join("\n"),
    );
  });

  it("pads ragged rows and counts wide characters", () => {
    const out = formatMarkdownTable("| a | b |\n|---|---|\n| 日本 |\n");
    expect(out.split("\n")[2]).toBe("| 日本 |     |");
  });

  it("rejects text without a separator row", () => {
    expect(() => formatMarkdownTable("| a |\n| b |")).toThrow(/separator/);
  });
});

describe("formatAllMarkdownTables", () => {
  it("formats every table but skips fenced code", () => {
    const doc = "# T\n|a|b|\n|-|-|\n|1|2|\n\n```\n|x|y|\n|-|-|\n```\n";
    const out = formatAllMarkdownTables(doc);
    expect(out).toContain("| a   | b   |");
    expect(out).toContain("```\n|x|y|\n|-|-|\n```");
  });
});

describe("CSV ⇄ Markdown", () => {
  it("converts CSV with quotes and right-aligns numeric columns", () => {
    const md = csvToMarkdown('name,price\n"Widget, large",9.50\nGizmo,12');
    expect(md.split("\n")).toEqual([
      "| name          | price |",
      "| ------------- | ----: |",
      "| Widget, large |  9.50 |",
      "| Gizmo         |    12 |",
    ]);
    expect(markdownToCsv(md)).toBe('name,price\n"Widget, large",9.50\nGizmo,12');
  });

  it("guesses delimiters", () => {
    expect(guessDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(guessDelimiter("a;b;c")).toBe(";");
  });

  it("splits rows with escaped pipes", () => {
    expect(splitRow("| a \\| b | c |")).toEqual(["a \\| b", "c"]);
  });
});

describe("alignDelimited", () => {
  it("pads columns and shrinks back to the same data", () => {
    const csv = "id,name,city\n1,Alice,Paris\n22,Bob,\"New York\"";
    const aligned = alignDelimited(csv);
    expect(aligned.split("\n")).toEqual([
      "id, name , city",
      "1 , Alice, Paris",
      "22, Bob  , New York",
    ]);
    expect(shrinkDelimited(aligned)).toBe("id,name,city\n1,Alice,Paris\n22,Bob,New York");
  });
});
