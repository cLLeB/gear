import { describe, expect, it } from "vitest";
import type { Tab } from "@/modules/tabs";
import {
  type CommandPaletteActionContext,
  createCommandPaletteActions,
} from "./actions";

function terminalTab(id: number): Tab {
  return {
    id,
    kind: "terminal",
    title: "shell",
    paneTree: { kind: "leaf", id: id * 10 },
    activeLeafId: id * 10,
  } as unknown as Tab;
}

/** A terminal tab already split into `panes` leaves. */
function splitTab(id: number, panes: number): Tab {
  return {
    ...terminalTab(id),
    paneTree: {
      kind: "split",
      id: id * 100,
      dir: "row",
      children: Array.from({ length: panes }, (_, i) => ({
        kind: "leaf",
        id: id * 10 + i,
      })),
    },
  } as unknown as Tab;
}

function baseContext(
  over: Partial<CommandPaletteActionContext> = {},
): CommandPaletteActionContext {
  const noop = () => {};
  return {
    tabs: [terminalTab(1)],
    activeId: 1,
    searchTarget: "content" as never,
    explorerRoot: "/workspace",
    home: "/home/me",
    openNewTab: noop,
    openNewPrivate: noop,
    openNewEditor: noop,
    openNewPreview: noop,
    closeActiveTabOrPane: noop,
    nextTab: noop,
    previousTab: noop,
    splitPaneRight: noop,
    splitPaneDown: noop,
    focusNextPane: noop,
    focusPreviousPane: noop,
    focusSearch: noop,
    focusExplorerSearch: noop,
    toggleSidebar: noop,
    toggleAi: noop,
    askAiSelection: noop,
    openSettings: noop,
    openShortcuts: noop,
    ...over,
  };
}

function reasonById(over: Partial<CommandPaletteActionContext>, id: string) {
  const item = createCommandPaletteActions(baseContext(over)).find(
    (i) => i.id === id,
  );
  if (!item) throw new Error(`no command item ${id}`);
  return item.disabledReason;
}

describe("createCommandPaletteActions", () => {
  it("enables split on a terminal tab below the pane limit", () => {
    expect(reasonById({}, "pane.splitRight")).toBeUndefined();
    expect(reasonById({}, "pane.splitDown")).toBeUndefined();
  });

  it("disables split when there is no terminal tab", () => {
    const editorTab = { ...terminalTab(1), kind: "editor" } as unknown as Tab;
    expect(reasonById({ tabs: [editorTab] }, "pane.splitRight")).toBe(
      "No terminal tab",
    );
  });

  it("disables split once the tab is at the pane limit", () => {
    expect(reasonById({ tabs: [splitTab(1, 4)] }, "pane.splitRight")).toBe(
      "Pane limit",
    );
  });

  it("disables close on the last tab with a single pane", () => {
    expect(reasonById({}, "tab.close")).toBe("Last tab");
  });

  it("enables close when more than one tab is open", () => {
    expect(
      reasonById({ tabs: [terminalTab(1), terminalTab(2)] }, "tab.close"),
    ).toBeUndefined();
  });

  it("enables close on the last tab once it has been split", () => {
    expect(reasonById({ tabs: [splitTab(1, 2)] }, "tab.close")).toBeUndefined();
  });

  it("disables pane focus when the tab has only one pane", () => {
    expect(reasonById({}, "pane.focusNext")).toBe("Only one pane");
  });

  it("disables content search when there is no searchable view", () => {
    expect(reasonById({ searchTarget: null as never }, "search.focus")).toBe(
      "No searchable view",
    );
  });

  it("disables explorer search when there is no workspace root", () => {
    expect(reasonById({ explorerRoot: null }, "explorer.search")).toBe(
      "No workspace root",
    );
  });

  it("disables the new editor tab only when there is no root and no home", () => {
    expect(reasonById({ explorerRoot: null }, "tab.newEditor")).toBeUndefined();
    expect(reasonById({ explorerRoot: null, home: null }, "tab.newEditor")).toBe(
      "No workspace root",
    );
  });
});
