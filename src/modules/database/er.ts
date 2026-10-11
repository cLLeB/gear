// ER diagram layout: tables as boxes sized by their columns, foreign keys as
// edges. Layered (Sugiyama-style): referenced tables to the left of the
// tables that point at them, cycles broken, rows ordered by barycenter to cut
// crossings; unrelated tables packed in a grid underneath.

import type { TableInfo } from "./store";

export interface ErNode {
  key: string;
  table: TableInfo;
  x: number;
  y: number;
  w: number;
  h: number;
  layer: number;
}

export interface ErEdge {
  from: string;
  to: string;
  name: string;
  columns: string[];
  refColumns: string[];
}

export const HEADER = 26;
export const ROW = 18;
const CHAR = 6.6;
const GAP_X = 90;
const GAP_Y = 28;

export const tableKey = (schema: string, name: string) => `${schema}.${name}`;

export function nodeSize(t: TableInfo, keysOnly: boolean): { w: number; h: number } {
  const cols = keysOnly ? t.columns.filter((c) => c.primaryKey || (t.foreignKeys ?? []).some((f) => f.columns.includes(c.name))) : t.columns;
  const longest = Math.max(t.name.length + 4, ...cols.map((c) => c.name.length + c.dataType.length + 4));
  return { w: Math.min(360, Math.max(140, Math.round(longest * CHAR) + 24)), h: HEADER + Math.max(1, cols.length) * ROW + 6 };
}

export function edgesOf(tables: TableInfo[]): ErEdge[] {
  const keys = new Set(tables.map((t) => tableKey(t.schema, t.name)));
  const out: ErEdge[] = [];
  for (const t of tables) {
    for (const f of t.foreignKeys ?? []) {
      const to = tableKey(f.refSchema, f.refTable);
      if (keys.has(to)) out.push({ from: tableKey(t.schema, t.name), to, name: f.name, columns: f.columns, refColumns: f.refColumns });
    }
  }
  return out;
}

/** Layer index per table: longest path from the tables nothing points at (cycles broken by DFS). */
export function layers(keys: string[], edges: ErEdge[]): Map<string, number> {
  const out = new Map<string, string[]>();
  for (const e of edges) if (e.from !== e.to) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  // Break cycles: drop back edges found by DFS.
  const state = new Map<string, 0 | 1 | 2>();
  const dag = new Map<string, string[]>();
  const visit = (k: string) => {
    state.set(k, 1);
    for (const n of out.get(k) ?? []) {
      if (state.get(n) === 1) continue; // back edge
      dag.set(k, [...(dag.get(k) ?? []), n]);
      if (!state.get(n)) visit(n);
    }
    state.set(k, 2);
  };
  for (const k of keys) if (!state.get(k)) visit(k);
  // A referencing table sits one layer right of everything it references.
  const layer = new Map<string, number>();
  const depth = (k: string, seen: Set<string>): number => {
    if (layer.has(k)) return layer.get(k)!;
    if (seen.has(k)) return 0;
    seen.add(k);
    const d = Math.max(-1, ...(dag.get(k) ?? []).map((n) => depth(n, seen))) + 1;
    layer.set(k, d);
    return d;
  };
  for (const k of keys) depth(k, new Set());
  return layer;
}

export function layout(tables: TableInfo[], opts: { keysOnly?: boolean } = {}): { nodes: ErNode[]; edges: ErEdge[]; width: number; height: number } {
  const edges = edgesOf(tables);
  const keys = tables.map((t) => tableKey(t.schema, t.name));
  const byKey = new Map(tables.map((t) => [tableKey(t.schema, t.name), t]));
  const connected = new Set(edges.flatMap((e) => [e.from, e.to]));
  const lay = layers(keys.filter((k) => connected.has(k)), edges);
  const nLayers = Math.max(0, ...[...lay.values()].map((l) => l + 1));
  const rows: string[][] = Array.from({ length: nLayers }, () => []);
  for (const k of keys) if (connected.has(k)) rows[lay.get(k)!].push(k);
  // Barycenter sweeps: order each layer by the average position of its neighbours.
  const neighbours = new Map<string, string[]>();
  for (const e of edges) {
    neighbours.set(e.from, [...(neighbours.get(e.from) ?? []), e.to]);
    neighbours.set(e.to, [...(neighbours.get(e.to) ?? []), e.from]);
  }
  for (let sweep = 0; sweep < 4; sweep++) {
    const order = (L: number, ref: number) => {
      if (ref < 0 || ref >= nLayers) return;
      const pos = new Map(rows[ref].map((k, i) => [k, i]));
      const bary = (k: string) => {
        const ns = (neighbours.get(k) ?? []).filter((n) => pos.has(n)).map((n) => pos.get(n)!);
        return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : Number.POSITIVE_INFINITY;
      };
      rows[L].sort((a, b) => bary(a) - bary(b) || a.localeCompare(b));
    };
    if (sweep % 2 === 0) for (let L = 1; L < nLayers; L++) order(L, L - 1);
    else for (let L = nLayers - 2; L >= 0; L--) order(L, L + 1);
  }
  const nodes: ErNode[] = [];
  let x = 0;
  let height = 0;
  for (let L = 0; L < nLayers; L++) {
    let y = 0;
    let colW = 0;
    for (const k of rows[L]) {
      const t = byKey.get(k)!;
      const { w, h } = nodeSize(t, Boolean(opts.keysOnly));
      nodes.push({ key: k, table: t, x, y, w, h, layer: L });
      y += h + GAP_Y;
      colW = Math.max(colW, w);
    }
    height = Math.max(height, y);
    x += colW + GAP_X;
  }
  // Unrelated tables: a grid below.
  const rest = keys.filter((k) => !connected.has(k));
  if (rest.length) {
    const top = height + (height ? GAP_Y * 2 : 0);
    const perRow = Math.max(3, Math.ceil(Math.sqrt(rest.length * 1.6)));
    let cx = 0;
    let cy = top;
    let rowH = 0;
    rest.forEach((k, i) => {
      if (i && i % perRow === 0) {
        cx = 0;
        cy += rowH + GAP_Y;
        rowH = 0;
      }
      const t = byKey.get(k)!;
      const { w, h } = nodeSize(t, Boolean(opts.keysOnly));
      nodes.push({ key: k, table: t, x: cx, y: cy, w, h, layer: -1 });
      cx += w + GAP_Y;
      rowH = Math.max(rowH, h);
    });
    height = cy + rowH;
  }
  const width = Math.max(0, ...nodes.map((n) => n.x + n.w));
  return { nodes, edges, width, height };
}

/** Y of a column's row inside a node (for anchoring an edge), given which columns are shown. */
export function columnY(n: ErNode, column: string, keysOnly: boolean): number {
  const cols = keysOnly ? n.table.columns.filter((c) => c.primaryKey || (n.table.foreignKeys ?? []).some((f) => f.columns.includes(c.name))) : n.table.columns;
  const i = cols.findIndex((c) => c.name === column);
  return n.y + HEADER + (i < 0 ? 0 : i) * ROW + ROW / 2;
}

/** A smooth path from the FK column (right / left side) to the referenced column. */
export function edgePath(a: ErNode, ay: number, b: ErNode, by: number): string {
  const aRight = a.x + a.w;
  const bRight = b.x + b.w;
  // Pick the facing sides.
  const fromX = a.x > bRight ? a.x : aRight;
  const toX = a.x > bRight ? bRight : b.x > aRight ? b.x : bRight;
  if (a === b || Math.abs(fromX - toX) < 20) {
    // Self reference or vertically stacked: loop out to the right.
    const r = Math.max(aRight, bRight) + 40;
    return `M ${aRight} ${ay} C ${r} ${ay}, ${r} ${by}, ${bRight} ${by}`;
  }
  const mid = (fromX + toX) / 2;
  return `M ${fromX} ${ay} C ${mid} ${ay}, ${mid} ${by}, ${toX} ${by}`;
}

/** Count edge crossings between adjacent layers (for tests / quality checks). */
export function crossings(nodes: ErNode[], edges: ErEdge[]): number {
  const pos = new Map(nodes.map((n) => [n.key, n]));
  const segs = edges
    .map((e) => [pos.get(e.from)!, pos.get(e.to)!] as const)
    .filter(([a, b]) => a && b && a.layer >= 0 && b.layer >= 0 && Math.abs(a.layer - b.layer) === 1)
    .map(([a, b]) => (a.layer < b.layer ? [a.y, b.y, a.layer] : [b.y, a.y, b.layer]));
  let n = 0;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (segs[i][2] === segs[j][2] && (segs[i][0] - segs[j][0]) * (segs[i][1] - segs[j][1]) < 0) n++;
  return n;
}
