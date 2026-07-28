import { describe, expect, it } from "vitest";
import { PieceTable } from "./pieceTable";

describe("PieceTable basics", () => {
  it("returns the initial text", () => {
    const pt = new PieceTable("hello world");
    expect(pt.getText()).toBe("hello world");
    expect(pt.length).toBe(11);
  });

  it("inserts in the middle, at the start, and at the end", () => {
    const pt = new PieceTable("hello world");
    pt.insert(5, ",");
    expect(pt.getText()).toBe("hello, world");
    pt.insert(0, ">> ");
    expect(pt.getText()).toBe(">> hello, world");
    pt.insert(pt.length, "!");
    expect(pt.getText()).toBe(">> hello, world!");
  });

  it("deletes a range", () => {
    const pt = new PieceTable("hello world");
    pt.delete(0, 6); // remove "hello "
    expect(pt.getText()).toBe("world");
  });

  it("replaces a range", () => {
    const pt = new PieceTable("the quick brown fox");
    pt.replace(4, 9, "slow");
    expect(pt.getText()).toBe("the slow brown fox");
  });

  it("reads a sub-range across piece boundaries", () => {
    const pt = new PieceTable("abcdef");
    pt.insert(3, "XYZ"); // abcXYZdef
    expect(pt.getRange(2, 7)).toBe("cXYZd");
  });

  it("ignores empty and out-of-range edits gracefully", () => {
    const pt = new PieceTable("abc");
    pt.insert(2, "");
    pt.delete(1, 0);
    pt.delete(10, 5);
    expect(pt.getText()).toBe("abc");
  });
});

describe("PieceTable against a reference string (randomized)", () => {
  it("matches naive string edits across many random operations", () => {
    let reference = "start";
    const pt = new PieceTable(reference);
    // Deterministic pseudo-random sequence for reproducibility.
    let seed = 12345;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

    for (let i = 0; i < 400; i++) {
      const len = reference.length;
      if (rand() < 0.6 || len === 0) {
        const at = Math.floor(rand() * (len + 1));
        const text = String.fromCharCode(97 + Math.floor(rand() * 26)).repeat(1 + Math.floor(rand() * 3));
        pt.insert(at, text);
        reference = reference.slice(0, at) + text + reference.slice(at);
      } else {
        const at = Math.floor(rand() * len);
        const count = 1 + Math.floor(rand() * Math.min(4, len - at));
        pt.delete(at, count);
        reference = reference.slice(0, at) + reference.slice(at + count);
      }
      expect(pt.length).toBe(reference.length);
    }
    expect(pt.getText()).toBe(reference);
  });
});
