import { describe, expect, it } from "vitest";
import { parentDir, planDragMove, undoGroups } from "./dragMove";

describe("planDragMove", () => {
  it("splits moves, conflicts, no-ops and impossible moves", () => {
    const plan = planDragMove(
      ["/w/src/a.ts", "/w/src/lib", "/w/src/lib/inner.ts", "/w/docs/readme.md", "/w/dest/already.txt", "/w/dest/sub"],
      "/w/dest",
      new Set(["already.txt", "readme.md"]),
    );
    expect(plan).toEqual({
      moves: ["/w/src/a.ts", "/w/src/lib"],
      // inner.ts rides along with its folder.
      conflicts: ["/w/docs/readme.md"],
      unchanged: ["/w/dest/already.txt", "/w/dest/sub"],
      invalid: [],
    });
  });

  it("refuses to move a folder into its own subfolder", () => {
    expect(planDragMove(["/w/a"], "/w/a/b/c", new Set()).invalid).toEqual(["/w/a"]);
    // A sibling whose name starts the same way is fine.
    expect(planDragMove(["/w/a"], "/w/ab", new Set()).moves).toEqual(["/w/a"]);
  });

  it("treats two dragged items with one name as a conflict, and handles Windows paths", () => {
    expect(planDragMove(["/w/x/n.txt", "/w/y/n.txt"], "/w/z", new Set()).conflicts).toEqual(["/w/y/n.txt"]);
    const win = planDragMove(["C:\\w\\src\\A.TS"], "C:/w/Dest", new Set(["a.ts"]), true);
    expect(win.conflicts).toEqual(["C:/w/src/A.TS"]);
    expect(parentDir("C:\\w\\src\\a.ts")).toBe("C:/w/src");
    expect(parentDir("/a")).toBe("/");
  });

  it("groups moved files by their original folder for undo", () => {
    const g = undoGroups([
      { from: "/w/src/a.ts", to: "/w/dest/a.ts" },
      { from: "/w/src/b.ts", to: "/w/dest/b.ts" },
      { from: "/w/docs/c.md", to: "/w/dest/c.md" },
    ]);
    expect([...g.entries()]).toEqual([
      ["/w/src", ["/w/dest/a.ts", "/w/dest/b.ts"]],
      ["/w/docs", ["/w/dest/c.md"]],
    ]);
  });
});
