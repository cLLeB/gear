import { describe, expect, it } from "vitest";
import { type MoveOps, parentDir, planDragMove, runDragMove, undoGroups } from "./dragMove";

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

/** An in-memory folder: a set of paths, with moves that can be made to fail. */
function fakeFs(paths: string[], failMove: (source: string) => boolean = () => false) {
  const files = new Set(paths);
  const ops: MoveOps = {
    async move(source, destDir) {
      if (failMove(source)) throw new Error("denied");
      const to = `${destDir}/${source.slice(source.lastIndexOf("/") + 1)}`;
      if (files.has(to)) throw new Error("exists");
      files.delete(source);
      files.add(to);
      return to;
    },
    async rename(from, to) {
      if (!files.has(from) || files.has(to)) throw new Error("rename failed");
      files.delete(from);
      files.add(to);
    },
    async remove(path) {
      files.delete(path);
    },
  };
  return { files, ops };
}

describe("runDragMove", () => {
  it("replaces an existing item only after the new one has landed", async () => {
    const { files, ops } = fakeFs(["/w/src/a.txt", "/w/dest/a.txt"]);
    const out = await runDragMove(["/w/src/a.txt"], new Set(["/w/src/a.txt"]), "/w/dest", ["a.txt"], ops, "t1");
    expect(out).toEqual({ moved: [{ from: "/w/src/a.txt", to: "/w/dest/a.txt" }], failed: [], stranded: [] });
    expect([...files]).toEqual(["/w/dest/a.txt"]);
  });

  it("puts the replaced item back when the move fails", async () => {
    const { files, ops } = fakeFs(["/w/src/a.txt", "/w/dest/a.txt"], () => true);
    const out = await runDragMove(["/w/src/a.txt"], new Set(["/w/src/a.txt"]), "/w/dest", ["a.txt"], ops, "t1");
    expect(out.moved).toEqual([]);
    expect(out.failed).toEqual([{ path: "/w/src/a.txt", reason: "Error: denied" }]);
    expect(out.stranded).toEqual([]);
    expect([...files].sort()).toEqual(["/w/dest/a.txt", "/w/src/a.txt"]);
  });

  it("keeps moving after one item fails and reports both", async () => {
    const { files, ops } = fakeFs(["/w/src/a.txt", "/w/src/b.txt", "/w/src/c.txt"], (s) => s.endsWith("b.txt"));
    const out = await runDragMove(["/w/src/a.txt", "/w/src/b.txt", "/w/src/c.txt"], new Set(), "/w/dest", [], ops, "t1");
    expect(out.moved.map((m) => m.to)).toEqual(["/w/dest/a.txt", "/w/dest/c.txt"]);
    expect(out.failed.map((f) => f.path)).toEqual(["/w/src/b.txt"]);
    expect(files.has("/w/src/b.txt")).toBe(true);
  });

  it("matches the replaced name case-insensitively and never replaces a name that was not there", async () => {
    const { files, ops } = fakeFs(["/w/src/A.TXT", "/w/dest/a.txt"]);
    await runDragMove(["/w/src/A.TXT"], new Set(["/w/src/A.TXT"]), "/w/dest", ["a.txt"], ops, "t1", true);
    expect([...files]).toEqual(["/w/dest/A.TXT"]);

    // Marked for replace, but nothing by that name existed beforehand: nothing is set aside.
    const other = fakeFs(["/w/x/n.txt"]);
    const out = await runDragMove(["/w/x/n.txt"], new Set(["/w/x/n.txt"]), "/w/z", [], other.ops, "t1");
    expect(out.moved).toEqual([{ from: "/w/x/n.txt", to: "/w/z/n.txt" }]);
  });

  it("reports a set-aside copy it could not put back", async () => {
    const { files, ops } = fakeFs(["/w/src/a.txt", "/w/dest/a.txt"], () => true);
    const rename = ops.rename;
    let calls = 0;
    ops.rename = async (from, to) => {
      if (++calls > 1) throw new Error("locked");
      return rename(from, to);
    };
    const out = await runDragMove(["/w/src/a.txt"], new Set(["/w/src/a.txt"]), "/w/dest", ["a.txt"], ops, "t1");
    expect(out.stranded).toEqual(["/w/dest/a.txt.replaced-t1"]);
    expect(files.has("/w/dest/a.txt.replaced-t1")).toBe(true);
  });
});
