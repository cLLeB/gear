import { describe, expect, it } from "vitest";
import { computeCloseTargets } from "./closeTargets";
import type { Tab } from "./useTabs";

const terminal = (id: number): Tab =>
  ({
    id,
    kind: "terminal",
    title: "shell",
    paneTree: { kind: "leaf", id: id * 100 },
    activeLeafId: id * 100,
  }) as Tab;

const editor = (id: number, dirty: boolean): Tab =>
  ({
    id,
    kind: "editor",
    title: "f.ts",
    path: `/f${id}.ts`,
    dirty,
    preview: false,
  }) as Tab;

const markdown = (id: number): Tab =>
  ({ id, kind: "markdown", title: "n.md", path: `/n${id}.md` }) as Tab;

describe("computeCloseTargets", () => {
  const tabs = [terminal(1), editor(2, false), editor(3, true), markdown(4)];

  it("others = everything but the active tab", () => {
    expect(computeCloseTargets(tabs, 2).others).toEqual([1, 3, 4]);
  });

  it("saved = non-dirty documents, never terminals or dirty editors", () => {
    // terminal(1) kept (live), editor(3) kept (dirty); editor(2) + markdown(4) close.
    expect(computeCloseTargets(tabs, 1).saved).toEqual([2, 4]);
  });

  it("all = every tab id", () => {
    expect(computeCloseTargets(tabs, 1).all).toEqual([1, 2, 3, 4]);
  });

  it("saved is empty when only terminals and dirty editors are open", () => {
    expect(
      computeCloseTargets([terminal(1), editor(2, true)], 1).saved,
    ).toEqual([]);
  });
});
