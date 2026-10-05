import { describe, expect, it } from "vitest";
import {
  csvToJson,
  envToJson,
  jsonToCsv,
  jsonToEnv,
  jsonToMarkdownTable,
  jsonToQuery,
  jsonToXml,
  parseToml,
  queryToJson,
  toToml,
  xmlToJson,
} from "./formats";

describe("CSV", () => {
  it("round-trips with typed values and nested headers", () => {
    const rows = csvToJson("id,name,user.active,score\n1,Ada,true,9.5\n2,\"Lin, T\",false,\n");
    expect(rows).toEqual([
      { id: 1, name: "Ada", user: { active: true }, score: 9.5 },
      { id: 2, name: "Lin, T", user: { active: false }, score: "" },
    ]);
    expect(jsonToCsv(rows)).toBe('id,name,user.active,score\n1,Ada,true,9.5\n2,"Lin, T",false,\n');
  });

  it("detects tabs and semicolons", () => {
    expect(csvToJson("a\tb\n1\t2")).toEqual([{ a: 1, b: 2 }]);
    expect(csvToJson("a;b\nx;y")).toEqual([{ a: "x", b: "y" }]);
  });

  it("renders a Markdown table", () => {
    expect(jsonToMarkdownTable([{ a: 1, b: "x|y" }])).toBe("| a   | b    |\n| --- | ---- |\n| 1   | x\\|y |\n");
  });
});

describe("TOML", () => {
  const toml = `# config
title = "Gear"
version = 0x10
[server]
host = 'localhost'
ports = [ 8000, 8001,
  8002 ]
dates.started = 2024-01-02T03:04:05Z
inline = { a = 1, "b c" = true }

[[plugins]]
name = "a"
[[plugins]]
name = "b"
multi = """
line1
line2"""
`;
  it("parses tables, arrays of tables and value types", () => {
    expect(parseToml(toml)).toEqual({
      title: "Gear",
      version: 16,
      server: { host: "localhost", ports: [8000, 8001, 8002], dates: { started: "2024-01-02T03:04:05Z" }, inline: { a: 1, "b c": true } },
      plugins: [{ name: "a" }, { name: "b", multi: "line1\nline2" }],
    });
  });

  it("round-trips through toToml", () => {
    const v = parseToml(toml);
    expect(parseToml(toToml(v))).toEqual(v);
  });

  it("reports errors", () => {
    expect(() => parseToml("a = 1\na = 2")).toThrow(/Duplicate/);
    expect(() => parseToml('a = "x')).toThrow(/Unterminated/);
  });
});

describe("XML", () => {
  it("converts attributes, text, repeats and CDATA", () => {
    const xml = `<?xml version="1.0"?><!-- c --><catalog lang="en"><book id="1"><title>A &amp; B</title><price>9.5</price></book><book id="2"><title><![CDATA[<raw>]]></title></book><empty/></catalog>`;
    expect(xmlToJson(xml)).toEqual({
      catalog: {
        "@lang": "en",
        book: [
          { "@id": "1", title: "A & B", price: 9.5 },
          { "@id": "2", title: "<raw>" },
        ],
        empty: null,
      },
    });
  });

  it("writes XML back", () => {
    const out = jsonToXml({ catalog: { "@lang": "en", book: [{ title: "A & B" }, { title: "C" }] } });
    expect(out).toContain('<catalog lang="en">');
    expect(out).toContain("<title>A &amp; B</title>");
    expect(out.match(/<book>/g)).toHaveLength(2);
    expect(xmlToJson(out)).toEqual({ catalog: { "@lang": "en", book: [{ title: "A & B" }, { title: "C" }] } });
  });

  it("rejects mismatched tags", () => {
    expect(() => xmlToJson("<a><b></a>")).toThrow(/Expected <\/b>/);
  });
});

describe(".env and query strings", () => {
  it("parses .env with quotes, comments, export and multi-line values", () => {
    const env = 'export A=1\nB="two words" # note\nC=\'$raw\'\nD="line1\\nline2"\nE="multi\nline"\n# skip\nF=x # c\n';
    expect(envToJson(env)).toEqual({ A: "1", B: "two words", C: "$raw", D: "line1\nline2", E: "multi\nline", F: "x" });
    expect(jsonToEnv({ db: { hostName: "x y" }, port: 5432 })).toBe('DB_HOST_NAME="x y"\nPORT=5432\n');
  });

  it("parses query strings with arrays and nesting", () => {
    expect(queryToJson("https://x.dev/p?a=1&b[]=2&b[]=x&c[d]=hi+there&e=%26&f&a=3#frag")).toEqual({
      a: [1, 3],
      b: [2, "x"],
      c: { d: "hi there" },
      e: "&",
      f: "",
    });
    expect(jsonToQuery({ a: 1, b: [2, 3], c: { d: "x y" } })).toBe("a=1&b[]=2&b[]=3&c[d]=x%20y");
  });
});
