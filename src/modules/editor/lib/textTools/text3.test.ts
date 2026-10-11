import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  base58Decode,
  base58Encode,
  colorScale,
  colorScaleCss,
  escapeFor,
  flattenJson,
  fromBinary,
  fromMorse,
  inspectId,
  inspectUrl,
  joinLines,
  jsLiteralToJson,
  jsonSchemaFrom,
  lineFrequencies,
  markdownToHtml,
  minifySql,
  rot13,
  splitToLines,
  sqlInList,
  sqlKeywordCase,
  toBinary,
  toJsLiteral,
  toMorse,
  transposeCsv,
  unescapeFrom,
  unflattenJson,
  validateJson,
  wrapLines,
} from "./text3";

describe("JS literals", () => {
  it("converts both ways", () => {
    expect(toJsLiteral({ a: 1, "b-c": "it's", d: [true, null] })).toBe("{\n  a: 1,\n  'b-c': 'it\\'s',\n  d: [\n    true,\n    null,\n  ],\n}");
    expect(jsLiteralToJson("{ a: 1, 'b': [2,], }")).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}\n');
  });
});

describe("escaping", () => {
  it("round-trips per language", () => {
    const s = `He said "it's"\n\tdone\\`;
    for (const t of ["c", "java", "python", "shell", "powershell", "sql", "csv", "xml"] as const) {
      expect(unescapeFrom(escapeFor(s, t), t), t).toBe(s);
    }
    expect(escapeFor("a.b*c", "regex")).toBe("a\\.b\\*c");
    expect(unescapeFrom("a\\.b\\*c", "regex")).toBe("a.b*c");
    expect(escapeFor("it's", "shell")).toBe(`'it'\\''s'`);
  });
});

describe("lines", () => {
  it("joins, splits, wraps and builds IN lists", () => {
    expect(joinLines("a\n b \n\nc", ", ", "'")).toBe("'a', 'b', 'c'");
    expect(splitToLines("a, b,,c", ",")).toBe("a\nb\nc");
    expect(wrapLines("a\n\nb", "- [ ] ", "")).toBe("- [ ] a\n\n- [ ] b");
    expect(sqlInList("1\n2\n3")).toBe("IN (1, 2, 3)");
    expect(sqlInList("x\no'k")).toBe("IN ('x', 'o''k')");
  });

  it("transposes CSV and counts lines", () => {
    expect(transposeCsv("a,b,c\n1,2,3\n")).toBe("a,1\nb,2\nc,3\n");
    expect(lineFrequencies("x\ny\nx\nX\n", true)).toBe("3  x\n1  y\n");
  });
});

describe("colours", () => {
  it("builds scales", () => {
    const s = colorScale("#3b82f6");
    expect(s).toHaveLength(11);
    expect(s.find((x) => x.step === 500)!.hex).toBe("#3b82f6");
    expect(colorScaleCss("#3b82f6", "brand", "css")).toContain("--brand-500: #3b82f6;");
    expect(colorScaleCss("#3b82f6", "brand", "tailwind")).toContain('500: "#3b82f6",');
    expect(() => colorScale("blue")).toThrow();
  });
});

describe("encodings", () => {
  it("round-trips", () => {
    expect(base32Encode("foobar")).toBe("MZXW6YTBOI======");
    expect(base32Decode("MZXW6YTBOI======")).toBe("foobar");
    expect(base58Encode("hello world")).toBe("StV1DL6CwTryKyV");
    expect(base58Decode("StV1DL6CwTryKyV")).toBe("hello world");
    expect(rot13("Hello")).toBe("Uryyb");
    expect(toMorse("SOS hi")).toBe("... --- ... / .... ..");
    expect(fromMorse("... --- ... / .... ..")).toBe("sos hi");
    expect(fromBinary(toBinary("hé"))).toBe("hé");
  });
});

describe("inspection", () => {
  it("decodes ids", () => {
    const v7 = Object.fromEntries(inspectId("018f3c5e-8a2b-7c4d-9e1f-0a1b2c3d4e5f").map((r) => [r.label, r.value]));
    expect(v7.Type).toBe("UUID version 7");
    expect(v7.Created).toBe(new Date(0x018f3c5e8a2b).toISOString());
    expect(inspectId("01ARZ3NDEKTSV4RRFFQ69G5FAV")[1].value).toBe("2016-07-30T23:54:10.259Z");
    expect(inspectId("507f1f77bcf86cd799439011")[1].value).toBe("2012-10-17T21:13:27.000Z");
    expect(inspectId("1541815603606036480")[0].value).toContain("Snowflake");
    expect(() => inspectId("nope")).toThrow();
  });

  it("decodes URLs", () => {
    const r = Object.fromEntries(inspectUrl("https://u:p@x.dev:8443/a%20b?q=1&r=two#top").map((x) => [x.label, x.value]));
    expect(r.Host).toBe("x.dev");
    expect(r.Port).toBe("8443");
    expect(r.Path).toBe("/a b");
    expect(r["?r"]).toBe("two");
    expect(r.User).toContain("has password");
  });
});

describe("validation and schema", () => {
  it("locates JSON errors", () => {
    expect(validateJson('{"a": 1}')).toBeNull();
    const e = validateJson('{\n  "a": 1,\n  "b": ,\n}');
    expect(e?.line).toBe(3);
  });

  it("infers a schema with merged array items", () => {
    const s = jsonSchemaFrom({ id: 1, email: "a@b.co", tags: [{ n: 1 }, { n: 2.5, x: true }] }, "User") as Record<string, any>;
    expect(s.title).toBe("User");
    expect(s.properties.email).toEqual({ type: "string", format: "email" });
    expect(s.properties.tags.items.properties.n).toEqual({ type: "number" });
    expect(s.properties.tags.items.required).toEqual(["n"]);
  });

  it("flattens and unflattens", () => {
    const v = { a: { b: 1, c: [10, { d: 2 }] }, e: {} };
    const f = flattenJson(v);
    expect(f).toEqual({ "a.b": 1, "a.c.0": 10, "a.c.1.d": 2, e: {} });
    expect(unflattenJson(f)).toEqual(v);
  });
});

describe("markdown and sql", () => {
  it("renders Markdown", () => {
    const html = markdownToHtml("# T\n\nSome **b** and `c` [l](http://x).\n\n- [x] done\n- two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```js\nx<1\n```\n> q");
    expect(html).toContain("<h1>T</h1>");
    expect(html).toContain('<p>Some <strong>b</strong> and <code>c</code> <a href="http://x">l</a>.</p>');
    expect(html).toContain('<li><input type="checkbox" disabled checked> done</li>');
    expect(html).toContain("<td>1</td><td>2</td>");
    expect(html).toContain('<pre><code class="language-js">x&lt;1</code></pre>');
    expect(html).toContain("<blockquote><p>q</p></blockquote>");
  });

  it("changes keyword case outside strings and minifies", () => {
    expect(sqlKeywordCase("select name from users where note = 'select from'")).toBe("SELECT name FROM users WHERE note = 'select from'");
    expect(minifySql("SELECT a , b -- cols\nFROM t\n WHERE x = 'a  b'")).toBe("SELECT a,b FROM t WHERE x='a  b'");
  });
});
