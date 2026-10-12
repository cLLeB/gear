// Disk usage: the squarified treemap layout (Bruls, Huizing, van Wijk) and
// lookups in the size tree.

import type { UsageNode } from "@/modules/tools/paneHandle";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Tile<T> extends Rect {
  item: T;
}

function worst(row: number[], side: number): number {
  const sum = row.reduce((a, b) => a + b, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  const s2 = side * side;
  return Math.max((s2 * max) / (sum * sum), (sum * sum) / (s2 * min));
}

/**
 * Lays `items` (any order) out in `rect` with areas proportional to their size,
 * keeping tiles as square as possible. Items of size 0 get no tile.
 */
export function squarify<T>(items: T[], size: (t: T) => number, rect: Rect): Tile<T>[] {
  const sorted = items.filter((i) => size(i) > 0).sort((a, b) => size(b) - size(a));
  const total = sorted.reduce((a, i) => a + size(i), 0);
  if (!total || rect.w <= 0 || rect.h <= 0) return [];
  const scale = (rect.w * rect.h) / total;
  const out: Tile<T>[] = [];
  let { x, y, w, h } = rect;
  let i = 0;
  while (i < sorted.length) {
    const side = Math.min(w, h);
    const row: number[] = [];
    let j = i;
    while (j < sorted.length) {
      const next = size(sorted[j]) * scale;
      if (row.length && worst([...row, next], side) > worst(row, side)) break;
      row.push(next);
      j++;
    }
    const sum = row.reduce((a, b) => a + b, 0);
    const thick = sum / side;
    let offset = 0;
    row.forEach((area, k) => {
      const len = area / thick;
      // The row runs along the shorter side of what is left.
      out.push(w >= h ? { item: sorted[i + k], x, y: y + offset, w: thick, h: len } : { item: sorted[i + k], x: x + offset, y, w: len, h: thick });
      offset += len;
    });
    if (w >= h) {
      x += thick;
      w -= thick;
    } else {
      y += thick;
      h -= thick;
    }
    i = j;
  }
  return out;
}

/** The node reached by following child names from the root, or null. */
export function nodeAt(root: UsageNode, trail: string[]): UsageNode | null {
  let node: UsageNode | undefined = root;
  for (const name of trail) {
    node = node.children.find((c) => c.name === name && c.dir);
    if (!node) return null;
  }
  return node;
}

/** A stable colour per file extension (folders are neutral). */
export function hueFor(name: string): number {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : name.toLowerCase();
  let h = 0;
  for (let i = 0; i < ext.length; i++) h = (h * 31 + ext.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function percent(part: number, whole: number): string {
  if (!whole) return "0%";
  const p = (part / whole) * 100;
  return p >= 10 ? `${p.toFixed(0)}%` : p >= 0.1 ? `${p.toFixed(1)}%` : "<0.1%";
}
