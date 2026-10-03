import { describe, expect, it } from "vitest";
import { describeLayout, isSavedLayout, leafCount, templateFromTree } from "./layouts";

describe("layouts", () => {
  const tree = {
    kind: "split" as const,
    id: 90,
    dir: "row" as const,
    children: [
      { kind: "leaf" as const, id: 91, cwd: "/api", name: "server", slotId: 91 },
      { kind: "split" as const, id: 92, dir: "col" as const, children: [{ kind: "leaf" as const, id: 93, cwd: "/web" }, { kind: "leaf" as const, id: 94 }] },
    ],
  };

  it("builds a stable template without runtime ids", () => {
    expect(templateFromTree(tree)).toEqual({
      kind: "split",
      id: 1,
      dir: "row",
      children: [
        { kind: "leaf", id: 2, cwd: "/api", name: "server" },
        { kind: "split", id: 3, dir: "col", children: [{ kind: "leaf", id: 4, cwd: "/web", name: undefined }, { kind: "leaf", id: 5, cwd: undefined, name: undefined }] },
      ],
    });
    expect(leafCount(tree)).toBe(3);
  });

  it("describes and validates layouts", () => {
    const l = { id: "x", name: "dev", tree, commands: ["npm run dev", "", ""], createdAt: 0 };
    expect(describeLayout(l)).toBe("3 panes · 1 startup command");
    expect(isSavedLayout(l)).toBe(true);
    expect(isSavedLayout({ name: "x" })).toBe(false);
  });
});
