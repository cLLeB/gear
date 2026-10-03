import { describe, expect, it } from "vitest";
import { convertQuotes, nextQuote, stringAt } from "./quotes";

describe("stringAt", () => {
  it("finds the literal around the cursor, honouring escapes", () => {
    const line = `x = 'it\\'s' + "a"; // 'no'`;
    expect(stringAt(line, 6)).toEqual({ from: 4, to: 11, quote: "'" });
    expect(stringAt(line, 15)).toEqual({ from: 14, to: 17, quote: '"' });
    expect(stringAt(line, 24)).toBeNull();
  });
});

describe("convertQuotes", () => {
  it("re-escapes between styles", () => {
    expect(convertQuotes(`'it\\'s'`, '"')).toBe(`"it's"`);
    expect(convertQuotes(`"say \\"hi\\""`, "'")).toBe(`'say "hi"'`);
    expect(convertQuotes(`"it's"`, "'")).toBe(`'it\\'s'`);
    expect(convertQuotes(`"a\\nb"`, "`")).toBe("`a\\nb`");
    expect(convertQuotes(`'cost \${x}'`, "`")).toBe("`cost \\${x}`");
  });

  it("refuses template literals with interpolation", () => {
    expect(convertQuotes("`hi ${name}`", "'")).toBeNull();
  });

  it("cycles quote characters", () => {
    expect([nextQuote("'"), nextQuote('"'), nextQuote("`")]).toEqual(['"', "`", "'"]);
  });
});
