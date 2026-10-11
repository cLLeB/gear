import { describe, expect, it } from "vitest";
import { exportFileName, wrapHtmlDocument } from "./exportScrollback";

describe("exportFileName", () => {
  it("timestamps the file and picks the extension", () => {
    const d = new Date(2026, 0, 2, 3, 4, 5);
    expect(exportFileName("text", d)).toBe("terminal-20260102-030405.txt");
    expect(exportFileName("html", d)).toBe("terminal-20260102-030405.html");
    expect(exportFileName("ansi", d)).toBe("terminal-20260102-030405.ansi.txt");
  });
});

describe("wrapHtmlDocument", () => {
  it("produces a standalone document and escapes the title", () => {
    const doc = wrapHtmlDocument("<pre>hi</pre>", "a<b>");
    expect(doc.startsWith("<!doctype html>")).toBe(true);
    expect(doc).toContain("<pre>hi</pre>");
    expect(doc).toContain("a&#60;b&#62;");
  });
});
