import { describe, expect, it } from "vitest";
import { WorkspaceSymbolIndex } from "./symbolIndex";

const fileA = [
  "function fetchUser(id) { return id; }",
  "class UserRepository {}",
  "const API_BASE = 1;",
].join("\n");

const fileB = ["function formatBytes(n) { return n; }", "function parseConfig() {}"].join("\n");

describe("WorkspaceSymbolIndex", () => {
  it("indexes symbols from multiple files", () => {
    const idx = new WorkspaceSymbolIndex();
    idx.add("a.ts", fileA, "javascript");
    idx.add("b.ts", fileB, "javascript");
    expect(idx.size).toBeGreaterThanOrEqual(4);
    expect(idx.symbolsIn("a.ts").map((s) => s.name)).toContain("fetchUser");
  });

  it("finds a symbol by exact name across files", () => {
    const idx = new WorkspaceSymbolIndex();
    idx.add("a.ts", fileA, "javascript");
    idx.add("b.ts", fileB, "javascript");
    const hits = idx.search("formatBytes");
    expect(hits[0].name).toBe("formatBytes");
    expect(hits[0].path).toBe("b.ts");
  });

  it("ranks fuzzy subsequence matches", () => {
    const idx = new WorkspaceSymbolIndex();
    idx.add("a.ts", fileA, "javascript");
    idx.add("b.ts", fileB, "javascript");
    const hits = idx.search("fu"); // fetchUser, and (weaker) formatBytes has no 'u' after 'f'? it has none
    expect(hits.map((h) => h.name)).toContain("fetchUser");
  });

  it("returns nothing when a query character is absent everywhere", () => {
    const idx = new WorkspaceSymbolIndex();
    idx.add("a.ts", fileA, "javascript");
    expect(idx.search("zzzz")).toEqual([]);
  });

  it("re-indexing a file replaces its old symbols", () => {
    const idx = new WorkspaceSymbolIndex();
    idx.add("a.ts", "function original() {}", "javascript");
    expect(idx.search("original")).toHaveLength(1);
    idx.add("a.ts", "function replacement() {}", "javascript");
    expect(idx.search("original")).toEqual([]);
    expect(idx.search("replacement")).toHaveLength(1);
  });

  it("removing a file drops its symbols from search", () => {
    const idx = new WorkspaceSymbolIndex();
    idx.add("a.ts", fileA, "javascript");
    idx.add("b.ts", fileB, "javascript");
    idx.remove("b.ts");
    expect(idx.search("formatBytes")).toEqual([]);
    expect(idx.search("fetchUser")).toHaveLength(1);
  });

  it("returns highlight positions for the matched characters", () => {
    const idx = new WorkspaceSymbolIndex();
    idx.add("a.ts", fileA, "javascript");
    const [hit] = idx.search("fu");
    expect(hit.positions.length).toBeGreaterThan(0);
    // Every reported position indexes into the name.
    for (const p of hit.positions) expect(p).toBeLessThan(hit.name.length);
  });
});
