import { describe, expect, it } from "vitest";
import { PositionMapper } from "./position";

describe("PositionMapper", () => {
  const src = "abc\ndef\nghi";
  const m = new PositionMapper(src);

  it("maps offset to line/column", () => {
    expect(m.positionAt(0)).toEqual({ line: 1, column: 1 });
    expect(m.positionAt(4)).toEqual({ line: 2, column: 1 });
    expect(m.positionAt(6)).toEqual({ line: 2, column: 3 });
  });

  it("maps line/column to offset", () => {
    expect(m.offsetAt({ line: 2, column: 1 })).toBe(4);
    expect(m.offsetAt({ line: 3, column: 3 })).toBe(10);
  });

  it("round-trips", () => {
    for (let o = 0; o <= src.length; o++) {
      expect(m.offsetAt(m.positionAt(o))).toBe(o);
    }
  });

  it("counts lines and reads line text", () => {
    expect(m.lineCount).toBe(3);
    expect(m.lineText(2)).toBe("def");
  });

  it("clamps out-of-range offsets", () => {
    expect(m.positionAt(999)).toEqual({ line: 3, column: 4 });
  });
});
