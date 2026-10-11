// Saved terminal layouts ("launch configurations" in WezTerm / Warp): a
// split tree with per-pane directory, name and optional startup command.

import { isLeaf, type PaneNode } from "@/modules/terminal/lib/panes";

export interface SavedLayout {
  id: string;
  name: string;
  /** Leaves carry cwd/name; ids are placeholders re-minted on open. */
  tree: PaneNode;
  /** Startup command per leaf, in tree order ("" for none). */
  commands: string[];
  createdAt: number;
}

/** Strip runtime-only fields and renumber ids so the template is stable. */
export function templateFromTree(tree: PaneNode): PaneNode {
  let n = 1;
  const walk = (node: PaneNode): PaneNode =>
    isLeaf(node)
      ? { kind: "leaf", id: n++, cwd: node.cwd, name: node.name }
      : { kind: "split", id: n++, dir: node.dir, children: node.children.map(walk) };
  return walk(tree);
}

export function leafCount(tree: PaneNode): number {
  return isLeaf(tree) ? 1 : tree.children.reduce((s, c) => s + leafCount(c), 0);
}

export function describeLayout(l: SavedLayout): string {
  const panes = leafCount(l.tree);
  const cmds = l.commands.filter(Boolean).length;
  return `${panes} pane${panes === 1 ? "" : "s"}${cmds ? ` · ${cmds} startup command${cmds === 1 ? "" : "s"}` : ""}`;
}

const KEY = "gear.savedLayouts";

export function isSavedLayout(v: unknown): v is SavedLayout {
  if (!v || typeof v !== "object") return false;
  const o = v as SavedLayout;
  return typeof o.id === "string" && typeof o.name === "string" && !!o.tree && Array.isArray(o.commands);
}

export function loadLayouts(): SavedLayout[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isSavedLayout) : [];
  } catch {
    return [];
  }
}

export function saveLayouts(list: readonly SavedLayout[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Non-essential.
  }
}
