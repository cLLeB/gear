import { describe, expect, it } from "vitest";
import { formatMarkup, minifyMarkup } from "./markup";

describe("formatMarkup", () => {
  it("indents nesting and keeps text-only elements inline", () => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Hi</title></head><body><div class="a"  id='b'><p>Hello <b>world</b></p><br><img src="x.png"/></div></body></html>`;
    expect(formatMarkup(html)).toBe(
      [
        "<!doctype html>",
        "<html>",
        "  <head>",
        '    <meta charset="utf-8">',
        "    <title>Hi</title>",
        "  </head>",
        "  <body>",
        "    <div class=\"a\" id='b'>",
        "      <p>",
        "        Hello",
        "        <b>world</b>",
        "      </p>",
        "      <br>",
        '      <img src="x.png"/>',
        "    </div>",
        "  </body>",
        "</html>",
      ].join("\n"),
    );
  });

  it("preserves pre/script bodies and handles attributes containing >", () => {
    const html = `<div data-x="a>b"><pre>  keep\n   this</pre><script>if (a < b) { x(); }</script></div>`;
    expect(formatMarkup(html)).toBe(
      ['<div data-x="a>b">', "  <pre>  keep\n   this</pre>", "  <script>if (a < b) { x(); }</script>", "</div>"].join("\n"),
    );
  });

  it("formats XML with declarations, comments, CDATA and empty elements", () => {
    const xml = `<?xml version="1.0"?><root><!-- note --><item id="1"/><item><![CDATA[<raw>]]></item><empty></empty></root>`;
    expect(formatMarkup(xml)).toBe(
      ['<?xml version="1.0"?>', "<root>", "  <!-- note -->", '  <item id="1"/>', "  <item>", "    <![CDATA[<raw>]]>", "  </item>", "  <empty></empty>", "</root>"].join(
        "\n",
      ),
    );
  });
});

describe("minifyMarkup", () => {
  it("drops comments and inter-tag whitespace but keeps pre content", () => {
    expect(minifyMarkup("<ul>\n  <!-- x -->\n  <li> a  b </li>\n  <pre> k  </pre>\n</ul>")).toBe("<ul><li> a b </li><pre> k  </pre></ul>");
  });
});
