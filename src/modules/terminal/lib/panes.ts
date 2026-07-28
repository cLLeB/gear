export type PaneId = number;

export type SplitDir = "row" | "col";
export type PaneDirection = "left" | "right" | "up" | "down";

/** A leaf's on-screen box, in viewport coordinates (getBoundingClientRect). */
export type PaneBounds = {
  id: PaneId;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type PaneNode =
  | { kind: "leaf"; id: PaneId; slotId?: PaneId; cwd?: string; name?: string }
  | {
      kind: "split";
      id: PaneId;
      dir: SplitDir;
      children: PaneNode[];
    };

export function isLeaf(
  n: PaneNode,
): n is Extract<PaneNode, { kind: "leaf" }> {
  return n.kind === "leaf";
}

export function leafIds(n: PaneNode): PaneId[] {
  if (isLeaf(n)) return [n.id];
  return n.children.flatMap(leafIds);
}

/**
 * Stable identity for a subtree's *position* in the layout.
 *
 * A swap moves leaves between positions. Keying React panels by leaf id would
 * make every swap look like a remount and reset the resize handles, so panels
 * are keyed by slot id instead — it stays put while the leaf inside changes.
 */
export function firstLeafSlotId(n: PaneNode): PaneId {
  if (isLeaf(n)) return n.slotId ?? n.id;
  return firstLeafSlotId(n.children[0]);
}

/** Set a leaf's user-facing name (undefined clears it). Returns a new tree. */
export function setLeafName(n: PaneNode, id: PaneId, name: string): PaneNode {
  if (isLeaf(n)) {
    if (n.id !== id) return n;
    const trimmed = name.trim() || undefined;
    if (n.name === trimmed) return n;
    return { ...n, name: trimmed };
  }
  let changed = false;
  const next = n.children.map((c) => {
    const u = setLeafName(c, id, name);
    if (u !== c) changed = true;
    return u;
  });
  return changed ? { ...n, children: next } : n;
}

export function findLeafCwd(n: PaneNode, id: PaneId): string | undefined {
  if (isLeaf(n)) return n.id === id ? n.cwd : undefined;
  for (const c of n.children) {
    const found = findLeafCwd(c, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function setLeafCwd(
  n: PaneNode,
  id: PaneId,
  cwd: string,
): PaneNode {
  if (isLeaf(n)) {
    if (n.id !== id || n.cwd === cwd) return n;
    return { ...n, cwd };
  }
  let changed = false;
  const next = n.children.map((c) => {
    const u = setLeafCwd(c, id, cwd);
    if (u !== c) changed = true;
    return u;
  });
  return changed ? { ...n, children: next } : n;
}

/**
 * Insert a new leaf next to `targetId` in direction `dir`.
 *
 * If the target's enclosing split already runs in `dir`, the new leaf is
 * appended as a sibling there (avoids nested same-direction splits — keeps
 * the tree shallow and the resize handles aligned).
 */
export function splitLeaf(
  tree: PaneNode,
  targetId: PaneId,
  newSplitId: PaneId,
  newLeafId: PaneId,
  dir: SplitDir,
  newCwd?: string,
): PaneNode {
  if (tree.kind === "split" && tree.dir === dir) {
    const idx = tree.children.findIndex(
      (c) => c.kind === "leaf" && c.id === targetId,
    );
    if (idx >= 0) {
      const newLeaf: PaneNode = { kind: "leaf", id: newLeafId, cwd: newCwd };
      return {
        ...tree,
        children: [
          ...tree.children.slice(0, idx + 1),
          newLeaf,
          ...tree.children.slice(idx + 1),
        ],
      };
    }
  }
  if (isLeaf(tree)) {
    if (tree.id !== targetId) return tree;
    const newLeaf: PaneNode = { kind: "leaf", id: newLeafId, cwd: newCwd };
    return {
      kind: "split",
      id: newSplitId,
      dir,
      children: [tree, newLeaf],
    };
  }
  return {
    ...tree,
    children: tree.children.map((c) =>
      splitLeaf(c, targetId, newSplitId, newLeafId, dir, newCwd),
    ),
  };
}

/**
 * Remove a leaf and collapse single-child splits left in its wake. Returns
 * `null` when the entire subtree is gone.
 */
export function removeLeaf(
  tree: PaneNode,
  targetId: PaneId,
): PaneNode | null {
  if (isLeaf(tree)) return tree.id === targetId ? null : tree;
  const newChildren: PaneNode[] = [];
  for (const c of tree.children) {
    const r = removeLeaf(c, targetId);
    if (r !== null) newChildren.push(r);
  }
  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0];
  return { ...tree, children: newChildren };
}

export function nextLeafId(
  tree: PaneNode,
  currentId: PaneId,
  delta: 1 | -1,
): PaneId {
  const ids = leafIds(tree);
  if (ids.length === 0) return currentId;
  const idx = ids.indexOf(currentId);
  if (idx < 0) return ids[0];
  return ids[(idx + delta + ids.length) % ids.length];
}

// Closest neighbor of `leafId` within its enclosing split — prefer the
// next sibling, fall back to the previous. Used to pick the new focus
// when a pane closes (so focus stays in the same neighborhood instead of
// snapping to the first pane in the tree).
export function siblingLeafOf(
  tree: PaneNode,
  leafId: PaneId,
): PaneId | null {
  if (isLeaf(tree)) return null;
  for (let i = 0; i < tree.children.length; i++) {
    const c = tree.children[i];
    if (isLeaf(c) && c.id === leafId) {
      const sibling = tree.children[i + 1] ?? tree.children[i - 1];
      if (!sibling) return null;
      return leafIds(sibling)[0] ?? null;
    }
  }
  for (const c of tree.children) {
    if (!isLeaf(c)) {
      const r = siblingLeafOf(c, leafId);
      if (r !== null) return r;
    }
  }
  return null;
}

export function hasLeaf(tree: PaneNode, id: PaneId): boolean {
  return leafIds(tree).includes(id);
}

type PaneRect = {
  id: PaneId;
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Idealised geometry derived from the tree alone — every split divides its box
 * evenly. Used as a fallback when live DOM bounds aren't available (tests, or
 * before the panels have laid out), which is fine because the *relative*
 * arrangement is all directional targeting needs.
 */
function paneRects(
  node: PaneNode,
  x = 0,
  y = 0,
  width = 1,
  height = 1,
): PaneRect[] {
  if (isLeaf(node)) return [{ id: node.id, x, y, width, height }];
  const count = node.children.length;
  return node.children.flatMap((child, index) =>
    node.dir === "row"
      ? paneRects(child, x + (width * index) / count, y, width / count, height)
      : paneRects(child, x, y + (height * index) / count, width, height / count),
  );
}

/**
 * Pick the pane a directional swap should target: among panes that overlap the
 * active pane on the cross axis, the nearest one lying in `direction`. When
 * nothing lies that way the search wraps to the far end instead of failing.
 */
function directionalTarget(
  rects: PaneRect[],
  active: PaneRect,
  direction: PaneDirection,
): PaneId | null {
  const horizontal = direction === "left" || direction === "right";
  const forward = direction === "right" || direction === "down";
  const center = (r: PaneRect) =>
    horizontal ? r.x + r.width / 2 : r.y + r.height / 2;
  const crossCenter = (r: PaneRect) =>
    horizontal ? r.y + r.height / 2 : r.x + r.width / 2;
  const crossStart = (r: PaneRect) => (horizontal ? r.y : r.x);
  const crossEnd = (r: PaneRect) =>
    horizontal ? r.y + r.height : r.x + r.width;
  const overlaps = (r: PaneRect) =>
    crossStart(r) < crossEnd(active) && crossEnd(r) > crossStart(active);
  const others = rects.filter((r) => r.id !== active.id && overlaps(r));
  if (others.length === 0) return null;

  const ahead = others.filter((r) =>
    forward ? center(r) > center(active) : center(r) < center(active),
  );
  const candidates = ahead.length > 0 ? ahead : others;
  const axisKey = (r: PaneRect) =>
    ahead.length > 0
      ? Math.abs(center(r) - center(active))
      : forward
        ? center(r)
        : -center(r);
  const sorted = [...candidates].sort(
    (a, b) =>
      axisKey(a) - axisKey(b) ||
      Math.abs(crossCenter(a) - crossCenter(active)) -
        Math.abs(crossCenter(b) - crossCenter(active)),
  );
  return sorted[0]?.id ?? null;
}

function findLeaf(
  node: PaneNode,
  id: PaneId,
): Extract<PaneNode, { kind: "leaf" }> | null {
  if (isLeaf(node)) return node.id === id ? node : null;
  for (const child of node.children) {
    const found = findLeaf(child, id);
    if (found) return found;
  }
  return null;
}

function swapLeaves(
  node: PaneNode,
  first: Extract<PaneNode, { kind: "leaf" }>,
  second: Extract<PaneNode, { kind: "leaf" }>,
): PaneNode {
  if (isLeaf(node)) {
    // The leaf moves, its slot stays — see firstLeafSlotId.
    const slotId = node.slotId ?? node.id;
    if (node.id === first.id) return { ...second, slotId };
    if (node.id === second.id) return { ...first, slotId };
    return node;
  }
  return {
    ...node,
    children: node.children.map((child) => swapLeaves(child, first, second)),
  };
}

function rectsFromBounds(bounds: PaneBounds[]): PaneRect[] {
  return bounds
    .filter((rect) => rect.right > rect.left && rect.bottom > rect.top)
    .map((rect) => ({
      id: rect.id,
      x: rect.left,
      y: rect.top,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
    }));
}

/**
 * Swap the active leaf with its neighbour in `direction`. Returns the tree
 * unchanged when there is no neighbour that way.
 *
 * `liveBounds` (measured DOM rects) is preferred because users resize panes,
 * which the idealised tree geometry can't know about. It is only trusted when
 * it covers every leaf — a partial measurement would target the wrong pane.
 */
export function swapLeafInDirection(
  tree: PaneNode,
  activeId: PaneId,
  direction: PaneDirection,
  liveBounds?: PaneBounds[],
): PaneNode {
  const liveRects = liveBounds ? rectsFromBounds(liveBounds) : [];
  const liveIds = new Set(liveRects.map((rect) => rect.id));
  const hasCompleteLiveLayout = leafIds(tree).every((id) => liveIds.has(id));
  const rects = hasCompleteLiveLayout ? liveRects : paneRects(tree);
  const active = rects.find((rect) => rect.id === activeId);
  if (!active || rects.length < 2) return tree;
  const targetId = directionalTarget(rects, active, direction);
  if (targetId === null) return tree;
  const first = findLeaf(tree, activeId);
  const second = findLeaf(tree, targetId);
  return first && second ? swapLeaves(tree, first, second) : tree;
}
