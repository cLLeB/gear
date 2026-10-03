import { describe, expect, it } from "vitest";
import { buildToc, slugger, toggleWrap, upsertToc } from "./markdown";

describe("slugger", () => {
  it("matches GitHub anchors and dedupes", () => {
    const s = slugger();
    expect(s("Hello, World!")).toBe("hello-world");
    expect(s("Hello, World!")).toBe("hello-world-1");
    expect(s("`code` & [link](x) Ünïcode")).toBe("code--link-ünïcode");
  });
});

describe("buildToc / upsertToc", () => {
  const doc = "# Title\n\n## Install\n### From npm\n## Usage\n## Usage\n";
  it("builds nested entries for levels 2-4", () => {
    expect(buildToc(doc)).toBe(
      ["- [Install](#install)", "  - [From npm](#from-npm)", "- [Usage](#usage)", "- [Usage](#usage-1)"].join("\n"),
    );
  });

  it("inserts then refreshes in place", () => {
    const first = upsertToc(doc, doc.indexOf("## Install"));
    expect(first.updated).toBe(false);
    expect(first.text).toContain("<!-- toc -->\n- [Install](#install)");
    const edited = first.text.replace("## Usage\n## Usage", "## Usage\n## API");
    const second = upsertToc(edited, 0);
    expect(second.updated).toBe(true);
    expect(second.text).toContain("- [API](#api)");
    expect(second.text.match(/<!-- toc -->/g)).toHaveLength(1);
  });
});

describe("toggleWrap", () => {
  it("wraps, unwraps inside and unwraps around", () => {
    expect(toggleWrap("a word b", 2, 6, "**")).toMatchObject({ insert: "**word**", selFrom: 4, selTo: 8 });
    expect(toggleWrap("a **word** b", 2, 10, "**")).toMatchObject({ insert: "word" });
    expect(toggleWrap("a **word** b", 4, 8, "**")).toMatchObject({ from: 2, to: 10, insert: "word" });
  });
});
