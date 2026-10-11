import { describe, expect, it } from "vitest";
import { findEnclosingPair, pairFor, wrap } from "./surround";

const strip = (doc: string, at: number, to = at) => {
  const p = findEnclosingPair(doc, at, to);
  if (!p) return null;
  return doc.slice(0, p.openFrom) + doc.slice(p.openTo, p.closeFrom) + doc.slice(p.closeTo);
};

describe("pairFor / wrap", () => {
  it("maps brackets either way, tags and symmetric markers", () => {
    expect(wrap("x", pairFor("("))).toBe("(x)");
    expect(wrap("x", pairFor("]"))).toBe("[x]");
    expect(wrap("x", pairFor("<a href='#'>"))).toBe("<a href='#'>x</a>");
    expect(wrap("x", pairFor("em"))).toBe("<em>x</em>");
    expect(wrap("x", pairFor("**"))).toBe("**x**");
    expect(wrap("x", pairFor('"'))).toBe('"x"');
  });
});

describe("findEnclosingPair", () => {
  it("finds the innermost bracket with nesting", () => {
    expect(strip("f(a, [b, c])", 7)).toBe("f(a, b, c)");
    expect(strip("f(a, [b], c)", 10)).toBe("fa, [b], c");
  });

  it("finds quotes on the line, honouring escapes", () => {
    expect(strip('say("he said \\"hi\\"")', 8)).toBe('say(he said \\"hi\\")');
    expect(strip("x = 'abc' + 'def'", 14)).toBe("x = 'abc' + def");
  });

  it("finds enclosing tags, skipping nested same-name tags", () => {
    const doc = "<div><div>inner</div>outer</div>";
    expect(strip(doc, 23)).toBe("<div>inner</div>outer");
    expect(strip(doc, 12)).toBe("<div>innerouter</div>");
  });

  it("requires the pair to enclose the whole selection", () => {
    expect(findEnclosingPair("(a) b", 2, 5)).toBeNull();
  });

  it("returns null when nothing encloses", () => {
    expect(findEnclosingPair("plain text", 3, 3)).toBeNull();
  });
});
