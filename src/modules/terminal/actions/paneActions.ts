// Pane layout commands: zoom, equalize, flip, presets.

import { app } from "@/app/appBridge";
import { quickPick } from "@/modules/quick-pick";
import { toast } from "sonner";
import {
  applyLayoutPreset,
  flipParentSplit,
  leafCount,
  usePaneLayoutStore,
  type LayoutPreset,
} from "../lib/paneLayout";
import type { TerminalActionDescriptor } from "./terminalActions";

function activeTerminalTab() {
  const tab = app().tabs().find((t) => t.id === app().activeTabId());
  return tab?.kind === "terminal" ? tab : null;
}

function requireSplitTab() {
  const tab = activeTerminalTab();
  if (!tab) {
    toast.error("Focus a terminal tab first");
    return null;
  }
  if (leafCount(tab.paneTree) < 2) {
    toast.info("This tab has a single pane");
    return null;
  }
  return tab;
}

export function togglePaneZoom(): void {
  const tab = requireSplitTab();
  if (tab) usePaneLayoutStore.getState().toggleZoom(tab.id, tab.activeLeafId);
}

// Split ids only need to be unique within a tree; keep them far from tab/leaf ids.
let splitIdSeq = 2_000_000_000;

export const PANE_ACTIONS: TerminalActionDescriptor[] = [
  {
    id: "pane.toggleZoom",
    label: "Panes: Toggle zoom (maximize pane)",
    keywords: ["maximize", "fullscreen", "tmux", "focus", "zoom"],
    run: togglePaneZoom,
  },
  {
    id: "pane.equalize",
    label: "Panes: Equalize sizes",
    keywords: ["balance", "even", "reset", "sizes", "distribute"],
    run: () => {
      const tab = requireSplitTab();
      if (!tab) return;
      usePaneLayoutStore.getState().unzoom(tab.id);
      usePaneLayoutStore.getState().equalize(tab.id);
    },
  },
  {
    id: "pane.flipSplit",
    label: "Panes: Flip split direction",
    keywords: ["rotate", "orientation", "horizontal", "vertical", "toggle"],
    run: () => {
      const tab = requireSplitTab();
      if (!tab) return;
      app().setPaneTree(tab.id, flipParentSplit(tab.paneTree, tab.activeLeafId));
    },
  },
  {
    id: "pane.layoutPreset",
    label: "Panes: Apply layout…",
    keywords: ["tiled", "grid", "main", "even", "tmux", "arrange", "layout"],
    run: async () => {
      const tab = requireSplitTab();
      if (!tab) return;
      const preset = await quickPick<LayoutPreset>(
        [
          { label: "Tiled grid", detail: "All panes in a near-square grid", value: "tiled" },
          { label: "Side by side", detail: "Every pane in one row", value: "even-horizontal" },
          { label: "Stacked", detail: "Every pane in one column", value: "even-vertical" },
          { label: "Main left", detail: "Active pane on the left, others stacked on the right", value: "main-vertical" },
          { label: "Main top", detail: "Active pane on top, others side by side below", value: "main-horizontal" },
        ],
        { title: "Apply layout" },
      );
      if (!preset) return;
      usePaneLayoutStore.getState().unzoom(tab.id);
      app().setPaneTree(tab.id, applyLayoutPreset(tab.paneTree, preset, tab.activeLeafId, () => splitIdSeq++));
      // New splits mount with default sizes; balance them explicitly.
      setTimeout(() => usePaneLayoutStore.getState().equalize(tab.id), 0);
    },
  },
];
