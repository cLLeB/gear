import { describe, expect, it } from "vitest";
import { expandSelection, selectionRanges, shrinkSelection, type Range } from "./smartSelect";

const text = (src: string, r: Range) => src.slice(r.from, r.to);

describe("selectionRanges", () => {
  it("grows from the word outward through brackets to the whole document", () => {
    const src = "function f() {\n  return foo(bar);\n}\n";
    const offset = src.indexOf("bar");
    const chain = selectionRanges(src, "javascript", offset);

    // Smallest is the identifier under the cursor.
    expect(text(src, chain[0])).toBe("bar");
    // Somewhere in the chain: inside the call parens, then the whole function body.
    const rendered = chain.map((r) => text(src, r));
    expect(rendered).toContain("bar");
    expect(rendered.some((s) => s.includes("foo(bar)"))).toBe(true);
    // Last is the entire document.
    expect(chain[chain.length - 1]).toEqual({ from: 0, to: src.length });
  });

  it("produces a strictly nested, increasing chain", () => {
    const src = "const x = { a: [1, 2, 3] };\n";
    const offset = src.indexOf("2");
    const chain = selectionRanges(src, "javascript", offset);
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i].from).toBeLessThanOrEqual(chain[i - 1].from);
      expect(chain[i].to).toBeGreaterThanOrEqual(chain[i - 1].to);
      expect(chain[i].to - chain[i].from).toBeGreaterThan(chain[i - 1].to - chain[i - 1].from);
    }
  });

  it("offers the string content and then the whole string literal", () => {
    const src = 'const s = "hello world";\n';
    const offset = src.indexOf("hello");
    const rendered = selectionRanges(src, "javascript", offset).map((r) => text(src, r));
    expect(rendered).toContain("hello world");
    expect(rendered).toContain('"hello world"');
  });
});

describe("expandSelection / shrinkSelection", () => {
  it("expands to the next larger structural range", () => {
    const src = "function f() {\n  return foo(bar);\n}\n";
    const start = src.indexOf("bar");
    const word: Range = { from: start, to: start + 3 };
    const bigger = expandSelection(src, "javascript", word);
    expect(bigger.to - bigger.from).toBeGreaterThan(3);
    expect(bigger.from).toBeLessThanOrEqual(word.from);
    expect(bigger.to).toBeGreaterThanOrEqual(word.to);
  });

  it("expand then shrink returns to the original range", () => {
    const src = "const x = foo(bar);\n";
    const start = src.indexOf("bar");
    const word: Range = { from: start, to: start + 3 };
    const bigger = expandSelection(src, "javascript", word);
    const backAgain = shrinkSelection(src, "javascript", bigger);
    expect(backAgain).toEqual(word);
  });

  it("expanding the whole document is a no-op", () => {
    const src = "const x = 1;\n";
    const whole: Range = { from: 0, to: src.length };
    expect(expandSelection(src, "javascript", whole)).toEqual(whole);
  });
});
