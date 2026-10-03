import { beforeEach, describe, expect, it } from "vitest";
import {
  closedTabs,
  recordClosedTabs,
  reidTree,
  resetClosedTabs,
  snapshotTab,
  takeClosedTab,
} from "./closedTabs";
import type { Tab } from "./useTabs";

const terminal = (over: Partial<Extract<Tab, { kind: "terminal" }>> = {}): Tab => ({
  id: 1,
  kind: "terminal",
  title: "shell",
  paneTree: {
    kind: "split",
    id: 10,
    dir: "row",
    children: [
      { kind: "leaf", id: 11, cwd: "/a", slotId: 11 },
      { kind: "leaf", id: 12, cwd: "/b", name: "server" },
    ],
  },
  activeLeafId: 12,
  ...over,
});

beforeEach(() => resetClosedTabs());

describe("snapshotTab", () => {
  it("captures terminal layout and the active pane position", () => {
    const snap = snapshotTab(terminal(), 5);
    expect(snap).toMatchObject({ kind: "terminal", activeIndex: 1, closedAt: 5 });
  });

  it("never remembers private or run terminals", () => {
    expect(snapshotTab(terminal({ private: true }))).toBeNull();
    expect(snapshotTab(terminal({ run: true }))).toBeNull();
  });

  it("captures editors and previews, skips empty previews", () => {
    expect(snapshotTab({ id: 2, kind: "editor", title: "a.ts", path: "/a.ts", dirty: false, preview: false })).toMatchObject({ path: "/a.ts" });
    expect(snapshotTab({ id: 3, kind: "preview", title: "", url: "" })).toBeNull();
  });
});

describe("closed stack", () => {
  it("is most-recent-first and take removes entries", () => {
    recordClosedTabs([terminal()]);
    recordClosedTabs([{ id: 2, kind: "editor", title: "a", path: "/a", dirty: false, preview: false }]);
    expect(closedTabs().map((c) => c.kind)).toEqual(["editor", "terminal"]);
    expect(takeClosedTab()?.kind).toBe("editor");
    expect(closedTabs()).toHaveLength(1);
  });
});

describe("reidTree", () => {
  it("assigns fresh ids, drops slot ids, keeps cwd and names", () => {
    let n = 100;
    const source = (terminal() as Extract<Tab, { kind: "terminal" }>).paneTree;
    const { tree, leaves } = reidTree(source, () => n++);
    expect(leaves).toEqual([101, 102]);
    expect(tree).toEqual({
      kind: "split",
      id: 100,
      dir: "row",
      children: [
        { kind: "leaf", id: 101, cwd: "/a", name: undefined },
        { kind: "leaf", id: 102, cwd: "/b", name: "server" },
      ],
    });
  });
});
