import { describe, expect, it } from "vitest";
import { escapeHtml, unescapeHtml } from "./htmlEntities";

describe("htmlEntities", () => {
  it("escapes significant characters", () => {
    expect(escapeHtml('<a href="x">& \'q\'</a>')).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp; &#39;q&#39;&lt;/a&gt;",
    );
  });

  it("round-trips", () => {
    const s = '<tag attr="v">a & b</tag>';
    expect(unescapeHtml(escapeHtml(s))).toBe(s);
  });

  it("decodes common variants", () => {
    expect(unescapeHtml("&apos;&#x27;")).toBe("''");
  });
});
