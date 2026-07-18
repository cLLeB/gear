import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvObjects, stringifyCsv, stringifyCsvObjects } from "./csv";

describe("parseCsv", () => {
  it("parses a simple grid", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("keeps delimiters inside quoted fields", () => {
    expect(parseCsv('"a,b",c')).toEqual([["a,b", "c"]]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsv('"she said ""hi"""')).toEqual([['she said "hi"']]);
  });

  it("keeps newlines inside quoted fields", () => {
    expect(parseCsv('"line1\nline2",x')).toEqual([["line1\nline2", "x"]]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("does not emit a phantom row for a trailing newline", () => {
    expect(parseCsv("a\nb\n")).toEqual([["a"], ["b"]]);
  });

  it("preserves an empty quoted final field", () => {
    expect(parseCsv('a,""')).toEqual([["a", ""]]);
  });

  it("supports a custom delimiter (TSV)", () => {
    expect(parseCsv("a\tb\tc", { delimiter: "\t" })).toEqual([["a", "b", "c"]]);
  });
});

describe("parseCsvObjects", () => {
  it("maps rows to objects keyed by the header", () => {
    const objs = parseCsvObjects("name,port\nweb,80\napi,443");
    expect(objs).toEqual([
      { name: "web", port: "80" },
      { name: "api", port: "443" },
    ]);
  });
});

describe("stringifyCsv", () => {
  it("quotes only fields that need it", () => {
    expect(stringifyCsv([["a", "b,c", 'd"e'], ["1", "2", "3"]])).toBe('a,"b,c","d""e"\n1,2,3');
  });

  it("round-trips through parseCsv", () => {
    const grid = [["name", "note"], ["x", "has, comma"], ["y", 'has "quote"'], ["z", "line\nbreak"]];
    expect(parseCsv(stringifyCsv(grid))).toEqual(grid);
  });
});

describe("stringifyCsvObjects", () => {
  it("emits a header row and round-trips", () => {
    const records = [{ a: "1", b: "2" }, { a: "3", b: "4" }];
    const csv = stringifyCsvObjects(records);
    expect(csv.split("\n")[0]).toBe("a,b");
    expect(parseCsvObjects(csv)).toEqual(records);
  });
});
