import { describe, expect, it } from "vitest";
import type { UsageNode } from "@/modules/tools/paneHandle";
import { hueFor, nodeAt, percent, squarify } from "./model";

const file = (name: string, size: number): UsageNode => ({ name, size, files: 1, dir: false, children: [] });
const dir = (name: string, children: UsageNode[]): UsageNode => ({ name, size: children.reduce((a, c) => a + c.size, 0), files: children.length, dir: true, children });

describe("disk usage model", () => {
  it("fills the rectangle with areas proportional to size", () => {
    const sizes = [6, 6, 4, 3, 2, 2, 1];
    const tiles = squarify(sizes, (n) => n, { x: 0, y: 0, w: 6, h: 4 });
    expect(tiles).toHaveLength(7);
    for (const t of tiles) expect(t.w * t.h).toBeCloseTo(t.item, 6);
    expect(tiles.reduce((a, t) => a + t.w * t.h, 0)).toBeCloseTo(24, 6);
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(-1e-9);
      expect(t.y).toBeGreaterThanOrEqual(-1e-9);
      expect(t.x + t.w).toBeLessThanOrEqual(6 + 1e-9);
      expect(t.y + t.h).toBeLessThanOrEqual(4 + 1e-9);
    }
    // The classic example: the first two tiles stack in a column 3 wide.
    expect(tiles[0]).toMatchObject({ x: 0, y: 0 });
    expect(tiles[0].w).toBeCloseTo(3, 6);
    expect(tiles[0].h).toBeCloseTo(2, 6);
  });

  it("no tiles overlap", () => {
    const tiles = squarify([9, 7, 5, 3, 3, 2, 1, 1], (n) => n, { x: 0, y: 0, w: 10, h: 7 });
    for (let a = 0; a < tiles.length; a++)
      for (let b = a + 1; b < tiles.length; b++) {
        const A = tiles[a];
        const B = tiles[b];
        const overlapW = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
        const overlapH = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
        expect(overlapW > 1e-6 && overlapH > 1e-6).toBe(false);
      }
  });

  it("skips empty items and empty rectangles", () => {
    expect(squarify([0, 0], (n) => n, { x: 0, y: 0, w: 5, h: 5 })).toEqual([]);
    expect(squarify([1], (n) => n, { x: 0, y: 0, w: 0, h: 5 })).toEqual([]);
    expect(squarify([4, 0], (n) => n, { x: 0, y: 0, w: 2, h: 2 })).toHaveLength(1);
  });

  it("walks a trail of folder names", () => {
    const root = dir("root", [dir("src", [dir("lib", [file("a.ts", 5)]), file("lib", 1)]), file("x", 2)]);
    expect(nodeAt(root, [])?.name).toBe("root");
    expect(nodeAt(root, ["src", "lib"])?.size).toBe(5);
    expect(nodeAt(root, ["src", "nope"])).toBeNull();
    expect(nodeAt(root, ["x"])).toBeNull();
  });

  it("formats shares and picks a stable hue", () => {
    expect(percent(50, 200)).toBe("25%");
    expect(percent(1, 200)).toBe("0.5%");
    expect(percent(1, 100000)).toBe("<0.1%");
    expect(percent(1, 0)).toBe("0%");
    expect(hueFor("a.ts")).toBe(hueFor("deep/b.TS"));
    expect(hueFor("a.ts")).not.toBe(hueFor("a.rs"));
  });
});
