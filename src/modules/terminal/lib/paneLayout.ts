// Pane layout operations beyond split/close/swap: zoom (tmux `prefix z`),
// equalize (tmux `select-layout even-*`, iTerm2 "Balance panes"), flipping a
// split's orientation, and rebuilding a tab into a preset layout.

import { create } from "zustand";
import { isLeaf, leafIds, type PaneId, type PaneNode, type SplitDir } from "./panes";

export function findLeafNode(tree: PaneNode, id: PaneId): Extract<PaneNode, { kind: "leaf" }> | null {
  if (isLeaf(tree)) return tree.id === id ? tree : null;
  for (const c of tree.children) {
    const hit = findLeafNode(c, id);
    if (hit) return hit;
  }
  return null;
}

/**
 * Percent sizes for a split's children so every leaf ends up the same size
 * along this split's axis: a child holding two side-by-side leaves (same
 * direction) gets twice the room of a single leaf. Children split the other
 * way count as one column/row.
 */
export function equalSizes(split: Extract<PaneNode, { kind: "split" }>): number[] {
  const weight = (n: PaneNode): number => {
    if (isLeaf(n)) return 1;
    if (n.dir === split.dir) return n.children.reduce((s, c) => s + weight(c), 0);
    return 1;
  };
  const weights = split.children.map(weight);
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (w / total) * 100);
}

/** Flip the orientation of the split that directly contains `leafId`. */
export function flipParentSplit(tree: PaneNode, leafId: PaneId): PaneNode {
  if (isLeaf(tree)) return tree;
  if (tree.children.some((c) => isLeaf(c) && c.id === leafId)) {
    return { ...tree, dir: tree.dir === "row" ? "col" : "row" };
  }
  let changed = false;
  const children = tree.children.map((c) => {
    const next = flipParentSplit(c, leafId);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...tree, children } : tree;
}

export type LayoutPreset = "even-horizontal" | "even-vertical" | "main-vertical" | "main-horizontal" | "tiled";

/**
 * Rebuild a tab's tree into a preset, keeping every leaf (and its cwd/name)
 * and putting `mainLeaf` first. `newId` mints ids for split nodes.
 */
export function applyLayoutPreset(
  tree: PaneNode,
  preset: LayoutPreset,
  mainLeaf: PaneId,
  newId: () => PaneId,
): PaneNode {
  const leaves: Array<Extract<PaneNode, { kind: "leaf" }>> = [];
  const collect = (n: PaneNode) => {
    if (isLeaf(n)) leaves.push(n);
    else n.children.forEach(collect);
  };
  collect(tree);
  if (leaves.length < 2) return tree;
  const mainIdx = Math.max(0, leaves.findIndex((l) => l.id === mainLeaf));
  const ordered = [leaves[mainIdx], ...leaves.filter((_, i) => i !== mainIdx)];
  const split = (dir: SplitDir, children: PaneNode[]): PaneNode =>
    children.length === 1 ? children[0] : { kind: "split", id: newId(), dir, children };

  switch (preset) {
    case "even-horizontal":
      return split("row", ordered);
    case "even-vertical":
      return split("col", ordered);
    case "main-vertical":
      return split("row", [ordered[0], split("col", ordered.slice(1))]);
    case "main-horizontal":
      return split("col", [ordered[0], split("row", ordered.slice(1))]);
    case "tiled": {
      const cols = Math.ceil(Math.sqrt(ordered.length));
      const rows: PaneNode[] = [];
      for (let i = 0; i < ordered.length; i += cols) rows.push(split("row", ordered.slice(i, i + cols)));
      return split("col", rows);
    }
  }
}

export function leafCount(tree: PaneNode): number {
  return leafIds(tree).length;
}

interface PaneLayoutState {
  /** tabId → zoomed leaf. */
  zoomed: Record<number, PaneId>;
  /** tabId → bump to re-balance every split in the tab. */
  equalizeEpoch: Record<number, number>;
  toggleZoom: (tabId: number, leafId: PaneId) => void;
  unzoom: (tabId: number) => void;
  equalize: (tabId: number) => void;
}

export const usePaneLayoutStore = create<PaneLayoutState>((set) => ({
  zoomed: {},
  equalizeEpoch: {},
  toggleZoom: (tabId, leafId) =>
    set((s) => {
      const next = { ...s.zoomed };
      if (next[tabId] === leafId) delete next[tabId];
      else next[tabId] = leafId;
      return { zoomed: next };
    }),
  unzoom: (tabId) =>
    set((s) => {
      if (!(tabId in s.zoomed)) return s;
      const next = { ...s.zoomed };
      delete next[tabId];
      return { zoomed: next };
    }),
  equalize: (tabId) =>
    set((s) => ({ equalizeEpoch: { ...s.equalizeEpoch, [tabId]: (s.equalizeEpoch[tabId] ?? 0) + 1 } })),
}));
