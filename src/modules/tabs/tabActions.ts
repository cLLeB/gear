import { app } from "@/app/appBridge";
import { compactRelativeTime } from "@/lib/toolkit/compactRelativeTime";
import { quickPick } from "@/modules/quick-pick";
import { toast } from "sonner";
import { closedTabs, type ClosedTab } from "./lib/closedTabs";
import { leafIds } from "@/modules/terminal/lib/panes";
import { labelFor } from "./lib/tabLabel";
import { MAX_PANES_PER_TAB } from "./lib/useTabs";

function describe(c: ClosedTab): string {
  switch (c.kind) {
    case "terminal": {
      const panes = leafIds(c.tree).length;
      return panes > 1 ? `terminal · ${panes} panes` : "terminal";
    }
    case "editor":
    case "markdown":
      return c.path;
    case "preview":
      return c.url;
  }
}

export async function pickClosedTab(): Promise<void> {
  const list = closedTabs();
  if (list.length === 0) {
    toast.info("No recently closed tabs");
    return;
  }
  const now = Date.now();
  const index = await quickPick(
    list.map((c, i) => ({
      label: c.kind === "terminal" ? (c.customTitle ?? c.title) : c.title,
      description: compactRelativeTime(c.closedAt, now),
      detail: describe(c),
      value: i,
    })),
    { title: "Reopen closed tab", placeholder: "Search recently closed tabs…" },
  );
  if (index !== undefined) app().reopenClosedTab(index);
}

// ── most-recently-used order ──────────────────────────────────────────────

let mru: number[] = [];

/** Called by App whenever the active tab changes. */
export function noteTabActivated(id: number): void {
  mru = [id, ...mru.filter((x) => x !== id)].slice(0, 100);
}

/** Tabs ordered by last activation (never-activated tabs last, in tab order). */
export function tabsByRecency<T extends { id: number }>(tabs: readonly T[], order: readonly number[] = mru): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return tabs
    .map((t, i) => ({ t, r: rank.get(t.id) ?? order.length + i }))
    .sort((a, b) => a.r - b.r)
    .map(({ t }) => t);
}

export async function switchToRecentTab(): Promise<void> {
  const tabs = tabsByRecency(app().tabs()).filter((t) => t.id !== app().activeTabId());
  if (!tabs.length) {
    toast.info("No other tabs");
    return;
  }
  const id = await quickPick(
    tabs.map((t) => ({ label: labelFor(t), description: t.kind, value: t.id })),
    { title: "Switch to recent tab", placeholder: "Most recently used first" },
  );
  if (id !== undefined) app().activateTab(id);
}

/** Alternate between the two most recent tabs (like Alt+Tab / `cd -`). */
export function toggleLastTab(): void {
  const prev = tabsByRecency(app().tabs()).find((t) => t.id !== app().activeTabId());
  if (prev) app().activateTab(prev.id);
}

// ── duplicate / break / join ──────────────────────────────────────────────

export function duplicateTab(): void {
  const active = app().tabs().find((t) => t.id === app().activeTabId());
  if (!active) return;
  if (active.kind === "terminal") {
    app().openTerminal({ cwd: app().activeCwd() });
    return;
  }
  if (active.kind === "editor" && active.path) {
    toast.info("Files open once per window; opened a terminal in its folder instead");
    app().openTerminal({ cwd: active.path.replace(/[\\/][^\\/]*$/, "") });
    return;
  }
  toast.info("Only terminal tabs can be duplicated");
}

export function movePaneToNewTab(): void {
  const leaf = app().activeTerminalLeaf();
  if (leaf === null) {
    toast.error("Focus a terminal pane first");
    return;
  }
  if (app().breakPaneToTab(leaf) === null) toast.info("This tab has only one pane");
}

export async function joinTabIntoCurrent(): Promise<void> {
  const current = app().tabs().find((t) => t.id === app().activeTabId());
  if (current?.kind !== "terminal") {
    toast.error("Focus a terminal tab first");
    return;
  }
  const others = tabsByRecency(app().tabs()).filter((t) => t.kind === "terminal" && t.id !== current.id);
  const src = await quickPick(
    others.map((t) => ({ label: labelFor(t), description: t.kind === "terminal" ? `${leafIds(t.paneTree).length} pane(s)` : undefined, value: t.id })),
    { title: "Bring a terminal tab into this one as a split", emptyText: "No other terminal tabs" },
  );
  if (src === undefined) return;
  const dir = await quickPick(
    [
      { label: "Side by side", value: "row" as const },
      { label: "Stacked", value: "col" as const },
    ],
    { title: "Arrange" },
  );
  if (!dir) return;
  if (!app().joinTabInto(src, current.id, dir)) toast.error(`A tab holds at most ${MAX_PANES_PER_TAB} panes`);
}

export const TAB_ACTIONS = [
  { id: "tabs.recent", label: "Tabs: Switch to recent tab…", keywords: ["mru", "recent", "switch", "ctrl+tab", "history", "last"], run: switchToRecentTab },
  { id: "tabs.toggleLast", label: "Tabs: Go to previously used tab", keywords: ["alt tab", "last", "previous", "toggle", "back"], run: toggleLastTab },
  { id: "tabs.duplicate", label: "Tabs: Duplicate terminal tab", keywords: ["clone", "copy", "same folder", "new tab here"], run: duplicateTab },
  { id: "panes.breakToTab", label: "Panes: Move pane to a new tab", keywords: ["break-pane", "tmux", "detach", "unsplit", "pop out"], run: movePaneToNewTab },
  { id: "panes.joinTab", label: "Panes: Join another tab into this one…", keywords: ["join-pane", "tmux", "merge", "combine", "split"], run: joinTabIntoCurrent },
];
