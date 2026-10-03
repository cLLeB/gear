// Recently closed tabs, for "Reopen closed tab" (Cmd/Ctrl+Shift+T) — browser
// and VS Code muscle memory. Terminal tabs come back with their split layout,
// pane names and per-pane directories (fresh shells, since the old processes
// are gone). Private terminals are never remembered.

import { isLeaf, type PaneNode } from "@/modules/terminal/lib/panes";
import type { Tab } from "./useTabs";

export type ClosedTab =
  | {
      kind: "terminal";
      title: string;
      customTitle?: string;
      tree: PaneNode;
      activeIndex: number;
      shellPath?: string;
      blocks?: boolean;
      spaceId?: string;
      closedAt: number;
    }
  | { kind: "editor"; title: string; path: string; spaceId?: string; closedAt: number }
  | { kind: "markdown"; title: string; path: string; spaceId?: string; closedAt: number }
  | { kind: "preview"; title: string; url: string; spaceId?: string; closedAt: number };

const MAX_CLOSED = 25;
let stack: ClosedTab[] = [];
const listeners = new Set<() => void>();

/** Snapshot a tab for later reopening, or null for kinds we don't restore. */
export function snapshotTab(tab: Tab, now = Date.now()): ClosedTab | null {
  switch (tab.kind) {
    case "terminal": {
      if (tab.private || tab.run) return null;
      const order: number[] = [];
      const walk = (n: PaneNode) => (isLeaf(n) ? order.push(n.id) : n.children.forEach(walk));
      walk(tab.paneTree);
      return {
        kind: "terminal",
        title: tab.title,
        customTitle: tab.customTitle,
        tree: tab.paneTree,
        activeIndex: Math.max(0, order.indexOf(tab.activeLeafId)),
        shellPath: tab.shellPath,
        blocks: tab.blocks,
        spaceId: tab.spaceId,
        closedAt: now,
      };
    }
    case "editor":
      return { kind: "editor", title: tab.title, path: tab.path, spaceId: tab.spaceId, closedAt: now };
    case "markdown":
      return { kind: "markdown", title: tab.title, path: tab.path, spaceId: tab.spaceId, closedAt: now };
    case "preview":
      return tab.url ? { kind: "preview", title: tab.title, url: tab.url, spaceId: tab.spaceId, closedAt: now } : null;
    default:
      return null;
  }
}

export function recordClosedTabs(tabs: readonly Tab[]): void {
  const snaps = tabs.map((t) => snapshotTab(t)).filter((s): s is ClosedTab => s !== null);
  if (snaps.length === 0) return;
  stack = [...snaps.reverse(), ...stack].slice(0, MAX_CLOSED);
  for (const l of listeners) l();
}

export function closedTabs(): readonly ClosedTab[] {
  return stack;
}

/** Remove and return an entry (the most recent by default). */
export function takeClosedTab(index = 0): ClosedTab | null {
  const entry = stack[index] ?? null;
  if (entry) stack = stack.filter((_, i) => i !== index);
  return entry;
}

export function subscribeClosedTabs(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Give every node of a remembered tree fresh ids (the old sessions were
 * disposed), dropping slot ids and keeping cwd and names.
 */
export function reidTree(tree: PaneNode, newId: () => number): { tree: PaneNode; leaves: number[] } {
  const leaves: number[] = [];
  const walk = (n: PaneNode): PaneNode => {
    if (isLeaf(n)) {
      const id = newId();
      leaves.push(id);
      return { kind: "leaf", id, cwd: n.cwd, name: n.name };
    }
    return { kind: "split", id: newId(), dir: n.dir, children: n.children.map(walk) };
  };
  return { tree: walk(tree), leaves };
}

/** Test hook. */
export function resetClosedTabs(): void {
  stack = [];
}
