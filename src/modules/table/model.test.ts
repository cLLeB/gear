import { describe, expect, it } from "vitest";
import { columnLetter, columnStats, deleteColumn, deleteRow, detectDelimiter, filterRows, insertColumn, insertRow, moveColumn, normalize, numeric, parseCsv, serializeCsv, setCell, sortOrder, toMarkdown } from "./model";

describe("table model", () => {
  it("parses quoting, embedded newlines and escaped quotes", () => {
    const t = parseCsv('name,note\n"Ada, Countess","said ""hi""\nthen left"\nLinus,\n');
    expect(t.rows).toEqual([["name", "note"], ["Ada, Countess", 'said "hi"\nthen left'], ["Linus", ""]]);
    expect(t.dialect).toEqual({ delimiter: ",", eol: "\n", finalNewline: true });
  });

  it("round-trips files in their own dialect", () => {
    for (const text of ['a,b\n1,2\n', 'a;b\r\n"x;y";2\r\n', "a\tb\n1\t2", 'a,b\n"multi\nline","q""uote"\n', 'a,b\n" padded ",x\n', "a|b\n1|2\n", ""]) {
      expect(serializeCsv(parseCsv(text))).toBe(text);
    }
    // A byte-order mark is not part of the first header.
    expect(parseCsv("﻿id,name\n1,x\n").rows[0]).toEqual(["id", "name"]);
    expect(parseCsv('a,b\n1,""\n').rows[1]).toEqual(["1", ""]);
    expect(parseCsv("a,b\n1,").rows).toEqual([["a", "b"], ["1", ""]]);
  });

  it("detects the delimiter", () => {
    expect(detectDelimiter("a;b;c\n1;2;3\n")).toBe(";");
    expect(detectDelimiter("a\tb\n1\t2\n")).toBe("\t");
    expect(detectDelimiter("a|b|c\n1|2|3\n")).toBe("|");
    expect(detectDelimiter('name,quote\nAda,"x; y; z"\n')).toBe(",");
    expect(detectDelimiter("just one column\nsecond line\n")).toBe(",");
    expect(detectDelimiter("a,b\n", "x.tsv")).toBe("\t");
  });

  it("recognises numbers", () => {
    expect(["12", "-3.5", "1,234.5", "45%", "$9", "1e3", ".5"].map(numeric)).toEqual([12, -3.5, 1234.5, 45, 9, 1000, 0.5]);
    expect(["", "abc", "1.2.3", "12abc", "1,2"].map(numeric)).toEqual([null, null, null, null, null]);
  });

  it("sorts numbers numerically, text naturally and blanks last", () => {
    const rows = [["b10"], ["9"], [""], ["100"], ["b9"], ["A"]];
    expect(sortOrder(rows, 0, "asc").map((i) => rows[i][0])).toEqual(["9", "100", "A", "b9", "b10", ""]);
    expect(sortOrder(rows, 0, "desc").map((i) => rows[i][0])).toEqual(["b10", "b9", "A", "100", "9", ""]);
  });

  it("filters by words, by column and by comparison", () => {
    const header = ["Name", "Age", "City"];
    const rows = [["Ada", "36", "London"], ["Linus", "28", "Helsinki"], ["Grace", "", "New York"], ["Alan", "41", "London"]];
    const pick = (q: string) => filterRows(rows, header, q).map((i) => rows[i][0]);
    expect(pick("")).toHaveLength(4);
    expect(pick("lon")).toEqual(["Ada", "Alan"]);
    expect(pick("lon al")).toEqual(["Alan"]);
    expect(pick("name:a")).toEqual(["Ada", "Grace", "Alan"]);
    expect(pick("age>30")).toEqual(["Ada", "Alan"]);
    expect(pick("age<=28")).toEqual(["Linus"]);
    expect(pick("city=london age>40")).toEqual(["Alan"]);
    expect(pick("city!=london")).toEqual(["Linus", "Grace"]);
    // An unknown column name is just a word to search for.
    expect(pick("nope:x")).toEqual([]);
  });

  it("summarises a column", () => {
    const s = columnStats([["1"], ["2"], [""], ["2"], ["x"]], 0);
    expect(s).toMatchObject({ filled: 4, empty: 1, distinct: 3, numbers: 3, min: 1, max: 2, sum: 5 });
    expect(s.mean).toBeCloseTo(5 / 3);
    expect(s.top[0]).toEqual(["2", 2]);
    expect(columnStats([["a"]], 0)).toMatchObject({ numbers: 0, min: null, sum: null, mean: null });
  });

  it("edits cells, rows and columns without touching the input", () => {
    const rows = [["h1", "h2"], ["a", "b"]];
    expect(setCell(rows, 1, 1, "z")).toEqual([["h1", "h2"], ["a", "z"]]);
    expect(setCell(rows, 1, 3, "z")[1]).toEqual(["a", "b", "", "z"]);
    expect(setCell(rows, 1, 1, "b")).toBe(rows);
    expect(insertRow(rows, 1)).toEqual([["h1", "h2"], ["", ""], ["a", "b"]]);
    expect(deleteRow(rows, 0)).toEqual([["a", "b"]]);
    expect(insertColumn(rows, 1, "new")).toEqual([["h1", "new", "h2"], ["a", "", "b"]]);
    expect(deleteColumn(rows, 0)).toEqual([["h2"], ["b"]]);
    expect(moveColumn(rows, 0, 1)).toEqual([["h2", "h1"], ["b", "a"]]);
    expect(moveColumn(rows, 0, 5)).toEqual(rows);
    expect(normalize([["a"], ["b", "c"]])).toEqual([["a", ""], ["b", "c"]]);
    expect(rows).toEqual([["h1", "h2"], ["a", "b"]]);
  });

  it("names columns and writes Markdown", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnLetter)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
    expect(toMarkdown(["a", "b"], [["1", "x|y"], ["2"]])).toBe("| a | b |\n| --- | --- |\n| 1 | x\\|y |\n| 2 |  |");
  });
});
