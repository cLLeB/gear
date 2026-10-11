import { describe, expect, it } from "vitest";
import {
  applyLayoutPreset,
  equalSizes,
  findLeafNode,
  flipParentSplit,
  usePaneLayoutStore,
} from "./paneLayout";
import { leafIds, type PaneNode } from "./panes";

const leaf = (id: number, cwd?: string): PaneNode => ({ kind: "leaf", id, cwd });
const split = (id: number, dir: "row" | "col", children: PaneNode[]): PaneNode => ({ kind: "split", id, dir, children });

// [1 | [2 / 3]] with [4 | 5] nested in the row direction
const tree = split(100, "row", [leaf(1, "/a"), split(101, "col", [leaf(2), leaf(3)]), split(102, "row", [leaf(4), leaf(5)])]);

describe("findLeafNode", () => {
  it("finds nested leaves", () => {
    expect(findLeafNode(tree, 5)).toEqual(leaf(5));
    expect(findLeafNode(tree, 9)).toBeNull();
  });
});

describe("equalSizes", () => {
  it("gives same-direction subtrees room per leaf", () => {
    const sizes = equalSizes(tree as Extract<PaneNode, { kind: "split" }>);
    expect(sizes.map((s) => Math.round(s))).toEqual([25, 25, 50]);
  });
});

describe("flipParentSplit", () => {
  it("flips only the split that holds the leaf", () => {
    const flipped = flipParentSplit(tree, 3) as Extract<PaneNode, { kind: "split" }>;
    expect(flipped.dir).toBe("row");
    expect((flipped.children[1] as Extract<PaneNode, { kind: "split" }>).dir).toBe("row");
    expect(flipParentSplit(tree, 999)).toBe(tree);
  });
});

describe("applyLayoutPreset", () => {
  let next = 1000;
  const id = () => next++;

  it("keeps every leaf and puts the main one first", () => {
    for (const preset of ["even-horizontal", "even-vertical", "main-vertical", "main-horizontal", "tiled"] as const) {
      const out = applyLayoutPreset(tree, preset, 4, id);
      expect(leafIds(out).sort()).toEqual([1, 2, 3, 4, 5]);
      expect(leafIds(out)[0]).toBe(4);
    }
  });

  it("builds a main-vertical layout", () => {
    const out = applyLayoutPreset(tree, "main-vertical", 1, id) as Extract<PaneNode, { kind: "split" }>;
    expect(out.dir).toBe("row");
    expect(out.children[0]).toEqual(leaf(1, "/a"));
    expect((out.children[1] as Extract<PaneNode, { kind: "split" }>).dir).toBe("col");
  });

  it("tiles into a near-square grid", () => {
    const out = applyLayoutPreset(tree, "tiled", 1, id) as Extract<PaneNode, { kind: "split" }>;
    expect(out.dir).toBe("col");
    expect(out.children.map((c) => leafIds(c).length)).toEqual([3, 2]);
  });

  it("leaves single panes alone", () => {
    expect(applyLayoutPreset(leaf(1), "tiled", 1, id)).toEqual(leaf(1));
  });
});

describe("usePaneLayoutStore", () => {
  it("toggles zoom per tab and bumps equalize epochs", () => {
    const s = usePaneLayoutStore.getState();
    s.toggleZoom(1, 7);
    expect(usePaneLayoutStore.getState().zoomed[1]).toBe(7);
    usePaneLayoutStore.getState().toggleZoom(1, 7);
    expect(usePaneLayoutStore.getState().zoomed[1]).toBeUndefined();
    usePaneLayoutStore.getState().equalize(3);
    usePaneLayoutStore.getState().equalize(3);
    expect(usePaneLayoutStore.getState().equalizeEpoch[3]).toBe(2);
  });
});
