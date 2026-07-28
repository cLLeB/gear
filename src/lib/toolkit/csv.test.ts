import { describe, expect, it } from "vitest";
import { parseCsv, stringifyCsv } from "./csv";

describe("parseCsv", () => {
  it("parses simple rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted delimiters and newlines", () => {
    expect(parseCsv('"a,b","c\nd"')).toEqual([["a,b", "c\nd"]]);
  });

  it("handles escaped quotes", () => {
    expect(parseCsv('"say ""hi"""')).toEqual([['say "hi"']]);
  });
});

describe("stringifyCsv", () => {
  it("quotes cells that need it", () => {
    expect(stringifyCsv([["a,b", "c"]])).toBe('"a,b",c');
  });

  it("round-trips", () => {
    const rows = [["a", "b,c"], ['d"e', "f"]];
    expect(parseCsv(stringifyCsv(rows))).toEqual(rows);
  });
});
