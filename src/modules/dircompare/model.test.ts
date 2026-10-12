import { describe, expect, it } from "vitest";
import type { CompareEntry } from "@/modules/tools/paneHandle";
import { counts, foldOneSided, joinPath, parentDirs, parseSkip, visible } from "./model";

const e = (rel: string, status: CompareEntry["status"], dir = false): CompareEntry => ({ rel, status, dir, left_size: 1, right_size: 1 });

const entries = [e("a.txt", "different"), e("only", "left", true), e("only/x.txt", "left"), e("only/deep", "left", true), e("only/deep/y.txt", "left"), e("same.txt", "same"), e("sub", "same", true), e("sub/new.txt", "right")];

describe("folder compare model", () => {
  it("counts files, not folders", () => {
    expect(counts(entries)).toEqual({ left: 2, right: 1, different: 1, same: 1 });
  });

  it("folds a one-sided folder into a single row", () => {
    expect(foldOneSided(entries).map((x) => x.rel)).toEqual(["a.txt", "only", "same.txt", "sub", "sub/new.txt"]);
  });

  it("filters by status and text, hiding folders that exist on both sides", () => {
    const folded = foldOneSided(entries);
    expect(visible(folded, "changes", "").map((x) => x.rel)).toEqual(["a.txt", "only", "sub/new.txt"]);
    expect(visible(folded, "all", "").map((x) => x.rel)).toEqual(["a.txt", "only", "same.txt", "sub/new.txt"]);
    expect(visible(folded, "right", "").map((x) => x.rel)).toEqual(["sub/new.txt"]);
    expect(visible(folded, "all", "NEW").map((x) => x.rel)).toEqual(["sub/new.txt"]);
  });

  it("joins with the root's separator", () => {
    expect(joinPath("C:\\a\\b\\", "x/y.txt")).toBe("C:\\a\\b\\x\\y.txt");
    expect(joinPath("/a/b", "x/y.txt")).toBe("/a/b/x/y.txt");
    expect(parentDirs("/r", "a/b/c.txt")).toEqual(["/r/a", "/r/a/b"]);
    expect(parentDirs("/r", "c.txt")).toEqual([]);
  });

  it("parses the skip list", () => {
    expect(parseSkip(" .git, node_modules  dist,.git ")).toEqual([".git", "node_modules", "dist"]);
  });
});
