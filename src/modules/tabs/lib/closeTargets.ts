import type { Tab } from "./useTabs";

export type CloseTargets = {
  /** Every tab except the active one. */
  others: number[];
  /** Tabs with no unsaved work that aren't live terminals — mirrors VS Code's
   * "Close Saved" (leaves dirty editors and running shells untouched). */
  saved: number[];
  /** Every tab. */
  all: number[];
};

function isSavedClosable(tab: Tab): boolean {
  if (tab.kind === "terminal") return false;
  if (tab.kind === "editor") return !tab.dirty;
  return true;
}

export function computeCloseTargets(tabs: Tab[], activeId: number): CloseTargets {
  return {
    others: tabs.filter((t) => t.id !== activeId).map((t) => t.id),
    saved: tabs.filter(isSavedClosable).map((t) => t.id),
    all: tabs.map((t) => t.id),
  };
}
