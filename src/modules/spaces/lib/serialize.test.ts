import { describe, expect, it } from "vitest";
import type { PaneNode } from "@/modules/terminal/lib/panes";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { hydrateTabs, serializeTabs, type SerializedTab } from "./serialize";

function counter(start = 100): () => number {
  let n = start;
  return () => n++;
}

function leafIdsOf(node: PaneNode): number[] {
  return node.kind === "leaf" ? [node.id] : node.children.flatMap(leafIdsOf);
}

function term(over: Partial<Extract<Tab, { kind: "terminal" }>>): Tab {
  return {
    id: 1,
    kind: "terminal",
    spaceId: "s1",
    title: "shell",
    paneTree: { kind: "leaf", id: 2, cwd: "/a" },
    activeLeafId: 2,
    ...over,
  } as Tab;
}

describe("serializeTabs", () => {
  it("drops private terminals and transient kinds", () => {
    const tabs: Tab[] = [
      term({ id: 1 }),
      term({ id: 3, private: true }),
      {
        id: 5,
        kind: "git-diff",
        spaceId: "s1",
        title: "d",
        path: "/a/x",
        repoRoot: "/a",
        mode: "+",
        originalPath: null,
        preview: false,
      },
      {
        id: 7,
        kind: "editor",
        spaceId: "s1",
        title: "x",
        path: "/a/x.ts",
        dirty: false,
        preview: false,
      },
    ];
    const out = serializeTabs(tabs);
    expect(out.map((t) => t.kind)).toEqual(["terminal", "editor"]);
  });

  it("keeps settings and git-history tabs", () => {
    const tabs: Tab[] = [
      { id: 1, kind: "settings", spaceId: "s1", title: "Settings", section: "ai" },
      {
        id: 3,
        kind: "git-history",
        spaceId: "s1",
        title: "History · main",
        repoRoot: "/repo",
      },
    ];
    expect(serializeTabs(tabs)).toEqual([
      { kind: "settings", section: "ai" },
      { kind: "git-history", repoRoot: "/repo" },
    ]);
  });

  it("drops an untitled editor, which has no path to reopen from", () => {
    const tabs: Tab[] = [
      {
        id: 1,
        kind: "editor",
        spaceId: "s1",
        title: "untitled",
        path: "",
        dirty: false,
        preview: false,
      },
    ];
    expect(serializeTabs(tabs)).toEqual([]);
  });

  it("carries the editor's manual language override", () => {
    const tabs: Tab[] = [
      {
        id: 1,
        kind: "editor",
        spaceId: "s1",
        title: "x",
        path: "/a/x.txt",
        dirty: false,
        preview: false,
        languageOverride: "ts",
      },
    ];
    expect(serializeTabs(tabs)).toEqual([
      { kind: "editor", path: "/a/x.txt", lang: "ts" },
    ]);
  });

  it("marks the active leaf in a split tree", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 10,
      dir: "row",
      children: [
        { kind: "leaf", id: 11, cwd: "/a" },
        { kind: "leaf", id: 12, cwd: "/b" },
      ],
    };
    const [s] = serializeTabs([term({ paneTree: tree, activeLeafId: 12 })]);
    const node = s as Extract<SerializedTab, { kind: "terminal" }>;
    expect(node.tree.kind).toBe("split");
    if (node.tree.kind === "split") {
      expect(node.tree.children[1]).toMatchObject({ cwd: "/b", active: true });
      expect(node.tree.children[0]).not.toHaveProperty("active");
    }
  });
});

describe("hydrateTabs", () => {
  it("round-trips structure, cwd, blocks and active leaf", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 10,
      dir: "col",
      children: [
        { kind: "leaf", id: 11, cwd: "/a" },
        { kind: "leaf", id: 12, cwd: "/b" },
      ],
    };
    const tabs: Tab[] = [
      term({
        paneTree: tree,
        activeLeafId: 12,
        blocks: true,
        customTitle: "x",
      }),
    ];
    const serialized = serializeTabs(tabs);
    const [restored] = hydrateTabs(serialized, "s2", counter());
    expect(restored.kind).toBe("terminal");
    if (restored.kind !== "terminal") return;

    expect(restored.spaceId).toBe("s2");
    expect(restored.cold).toBe(true);
    expect(restored.blocks).toBe(true);
    expect(restored.customTitle).toBe("x");
    expect(restored.paneTree.kind).toBe("split");

    const leaves = leafIdsOf(restored.paneTree);
    expect(new Set(leaves).size).toBe(2);
    expect(leaves).toContain(restored.activeLeafId);
    // active leaf was the second one, which carried /b
    expect(restored.cwd).toBe("/b");
  });

  it("round-trips the run terminal flag and keeps its name over the cwd", () => {
    const tabs: Tab[] = [
      term({
        paneTree: { kind: "leaf", id: 11, cwd: "/proj/src" },
        activeLeafId: 11,
        run: true,
      }),
    ];
    const [restored] = hydrateTabs(serializeTabs(tabs), "s2", counter());
    expect(restored.kind).toBe("terminal");
    if (restored.kind !== "terminal") return;
    expect(restored.run).toBe(true);
    expect(restored.title).toBe("Run");
  });

  it("leaves an ordinary terminal unflagged so runs never adopt it", () => {
    const tabs: Tab[] = [
      term({ paneTree: { kind: "leaf", id: 11, cwd: "/proj" }, activeLeafId: 11 }),
    ];
    const [restored] = hydrateTabs(serializeTabs(tabs), "s2", counter());
    if (restored.kind !== "terminal") throw new Error("expected terminal");
    expect(restored.run).toBeUndefined();
    expect(restored.title).toBe("proj");
  });

  it("allocates fresh, unique, monotonic ids across all tabs and leaves", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 10,
      dir: "row",
      children: [
        { kind: "leaf", id: 11, cwd: "/a" },
        { kind: "leaf", id: 12, cwd: "/b" },
      ],
    };
    const serialized = serializeTabs([
      term({ id: 1, paneTree: tree, activeLeafId: 11 }),
      term({ id: 2 }),
    ]);
    const restored = hydrateTabs(serialized, "s1", counter(100));

    const ids: number[] = [];
    for (const t of restored) {
      ids.push(t.id);
      if (t.kind === "terminal") ids.push(...leafIdsOf(t.paneTree));
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(Math.min(...ids)).toBeGreaterThanOrEqual(100);
  });

  it("returns empty for corrupted input without throwing", () => {
    expect(hydrateTabs([] as SerializedTab[], "s1", counter())).toEqual([]);
    expect(
      hydrateTabs(null as unknown as SerializedTab[], "s1", counter()),
    ).toEqual([]);
  });

  it("hydrates editor/preview/markdown as cold with derived titles", () => {
    const serialized: SerializedTab[] = [
      { kind: "editor", path: "/a/foo.ts" },
      { kind: "preview", url: "http://localhost:5173/x" },
      { kind: "markdown", path: "/a/README.md" },
    ];
    const out = hydrateTabs(serialized, "s1", counter());
    expect(out.every((t) => t.cold === true)).toBe(true);
    expect(out.map((t) => t.title)).toEqual([
      "foo.ts",
      "localhost:5173",
      "README.md",
    ]);
  });

  it("restores an editor tab pinned, so the next explorer click keeps it", () => {
    const [tab] = hydrateTabs(
      [{ kind: "editor", path: "/a/foo.ts", lang: "ts" }],
      "s1",
      counter(),
    );
    expect(tab).toMatchObject({
      kind: "editor",
      preview: false,
      languageOverride: "ts",
    });
  });

  it("hydrates settings and git-history tabs", () => {
    const out = hydrateTabs(
      [
        { kind: "settings", section: "ai" },
        { kind: "git-history", repoRoot: "/repo" },
      ],
      "s1",
      counter(),
    );
    expect(out).toMatchObject([
      { kind: "settings", section: "ai", cold: true },
      { kind: "git-history", repoRoot: "/repo", cold: true },
    ]);
  });

  it("round-trips every restorable kind through serialize and back", () => {
    const serialized: SerializedTab[] = [
      { kind: "terminal", tree: { kind: "leaf", cwd: "/a", active: true } },
      { kind: "editor", path: "/a/x.ts" },
      { kind: "preview", url: "http://localhost:5173/x" },
      { kind: "markdown", path: "/a/README.md" },
      { kind: "settings" },
      { kind: "git-history", repoRoot: "/repo" },
    ];
    const tabs = hydrateTabs(serialized, "s1", counter());
    expect(tabs).toHaveLength(serialized.length);
    expect(serializeTabs(tabs)).toEqual(serialized);
  });
});
