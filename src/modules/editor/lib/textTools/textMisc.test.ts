import { describe, expect, it } from "vitest";
import {
  cleanSuspiciousChars,
  findSuspiciousChars,
  integerForms,
  parseIntegerLiteral,
  sentenceCase,
  shuffleLines,
  sortByColumn,
  sortByLength,
  sortNatural,
  sortNumeric,
  swapCase,
  textStats,
  titleCase,
} from "./textMisc";

describe("textStats", () => {
  it("counts words, sentences and paragraphs", () => {
    const s = textStats("Hello world. Hello again!\n\nSecond paragraph here.");
    expect(s.words).toBe(7);
    expect(s.uniqueWords).toBe(6);
    expect(s.sentences).toBe(3);
    expect(s.paragraphs).toBe(2);
    expect(s.lines).toBe(3);
    expect(s.topWords[0]).toEqual(["hello", 2]);
  });
});

describe("line sorts", () => {
  it("sorts naturally, by length, numerically and by column", () => {
    expect(sortNatural(["file10", "file2", "File1"])).toEqual(["File1", "file2", "file10"]);
    expect(sortByLength(["ccc", "a", "bb", "d"])).toEqual(["a", "d", "bb", "ccc"]);
    expect(sortNumeric(["v 10", "x", "v 9.5", "v 1,200"])).toEqual(["v 9.5", "v 10", "v 1,200", "x"]);
    expect(sortByColumn(["a,3", "b,1", "c,2"], 2)).toEqual(["b,1", "c,2", "a,3"]);
    expect(sortByColumn(["x  10", "y  9"], 2, true)).toEqual(["x  10", "y  9"]);
  });

  it("shuffles deterministically with an injected rng", () => {
    const out = shuffleLines(["a", "b", "c", "d"], () => 0);
    expect(out.sort()).toEqual(["a", "b", "c", "d"]);
  });
});

describe("integers", () => {
  it("parses literals", () => {
    expect(parseIntegerLiteral("0xFF")).toBe(255n);
    expect(parseIntegerLiteral("0b1010")).toBe(10n);
    expect(parseIntegerLiteral("1_000_000")).toBe(1000000n);
    expect(parseIntegerLiteral("-42")).toBe(-42n);
    expect(parseIntegerLiteral("12UL")).toBe(12n);
    expect(parseIntegerLiteral("1.5")).toBeNull();
  });

  it("offers base and interpretation forms", () => {
    const f = Object.fromEntries(integerForms(65n).map((x) => [x.label, x.value]));
    expect(f.Hex).toBe("0x41");
    expect(f.Binary).toBe("0b1000001");
    expect(f.Character).toBe("A");
    const t = Object.fromEntries(integerForms(1700000000n).map((x) => [x.label, x.value]));
    expect(t["As Unix time"]).toBe("2023-11-14T22:13:20.000Z");
    expect(t["As bytes"]).toBe("1.58 GiB");
  });
});

describe("case", () => {
  it("title-cases with small words and acronyms", () => {
    expect(titleCase("the lord of the rings: the return of NASA and iPhone")).toBe(
      "The Lord of the Rings: The Return of NASA and iPhone",
    );
  });
  it("sentence and swap case", () => {
    expect(sentenceCase("HELLO THERE. how ARE you?")).toBe("Hello there. How are you?");
    expect(swapCase("aBc")).toBe("AbC");
  });
});

describe("suspicious characters", () => {
  it("finds Trojan Source bidi controls, zero-widths, odd spaces and homoglyphs", () => {
    const text = `if (isAdmin‮) {}​ x = "pаypal";`; // Cyrillic а
    const found = findSuspiciousChars(text);
    expect(found.map((f) => f.kind)).toEqual(["bidi", "invisible", "space", "homoglyph"]);
    expect(found[0].label).toContain("RIGHT-TO-LEFT OVERRIDE");
  });

  it("ignores a leading BOM and pure non-Latin words", () => {
    expect(findSuspiciousChars("﻿привет world")).toEqual([]);
  });

  it("cleans", () => {
    expect(cleanSuspiciousChars("a​b c‮d")).toBe("ab cd");
  });
});
