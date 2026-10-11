import { describe, expect, it } from "vitest";
import { documentOutline, markdownHeadings } from "./outline";

describe("markdownHeadings", () => {
  it("nests headings and skips fenced code", () => {
    const md = "# Title\n\n## Install\n```\n# not a heading\n```\n### From source\n## Usage ##\n";
    expect(markdownHeadings(md).map((h) => [h.name, h.depth, h.container])).toEqual([
      ["Title", 0, ""],
      ["Install", 1, "Title"],
      ["From source", 2, "Title › Install"],
      ["Usage", 1, "Title"],
    ]);
    expect(md.slice(markdownHeadings(md)[1].from).startsWith("## Install")).toBe(true);
  });
});

describe("documentOutline", () => {
  it("flattens code symbols with containers", () => {
    const src = "class Shop {\n  checkout() {}\n}\nfunction helper() {}\n";
    const items = documentOutline(src, "javascript").map((i) => i.name);
    expect(items).toContain("Shop");
    expect(items).toContain("helper");
  });
});
