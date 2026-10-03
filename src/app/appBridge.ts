// A narrow, late-bound handle on App-level capabilities (opening tabs, finding
// the focused terminal, the workspace root). Feature modules — palette actions,
// terminal intelligence, workflows — call through here instead of threading
// more props and callbacks through App.tsx. App registers the live
// implementation on mount; until then every call is a safe no-op.

import type { Tab } from "@/modules/tabs";
import type { PaneNode } from "@/modules/terminal/lib/panes";

export interface OpenTerminalOptions {
  cwd?: string | null;
  /** Submitted once the shell is ready. */
  command?: string;
}

export interface AppBridge {
  openFile: (path: string, line?: number) => void;
  openTerminal: (options?: OpenTerminalOptions) => void;
  openPreview: (url: string) => void;
  /** Leaf id of the active pane when the active tab is a terminal. */
  activeTerminalLeaf: () => number | null;
  /** Explorer root, else launch dir, else home. */
  workspaceRoot: () => string | null;
  /** Cwd of the active terminal pane, falling back to the workspace root. */
  activeCwd: () => string | null;
  tabs: () => Tab[];
  activeTabId: () => number;
  activateTab: (id: number) => void;
  /** Renames the active tab (empty string clears the custom title). */
  renameTab: (id: number, title: string) => void;
  /** Reopen the n-th most recently closed tab; false when there is none. */
  reopenClosedTab: (index?: number) => boolean;
  /** Replace a terminal tab's pane layout (same leaves, new arrangement). */
  setPaneTree: (tabId: number, tree: PaneNode) => void;
}

const noop: AppBridge = {
  openFile: () => {},
  openTerminal: () => {},
  openPreview: () => {},
  activeTerminalLeaf: () => null,
  workspaceRoot: () => null,
  activeCwd: () => null,
  tabs: () => [],
  activeTabId: () => -1,
  activateTab: () => {},
  renameTab: () => {},
  setPaneTree: () => {},
  reopenClosedTab: () => false,
};

let bridge: AppBridge = noop;

export function registerAppBridge(impl: AppBridge): () => void {
  bridge = impl;
  return () => {
    if (bridge === impl) bridge = noop;
  };
}

export function app(): AppBridge {
  return bridge;
}
