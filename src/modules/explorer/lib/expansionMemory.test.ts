import { describe, expect, it } from "vitest";
import {
  MAX_REMEMBERED,
  MAX_ROOTS,
  parseMemory,
  recallExpansion,
  rememberExpansion,
  type StorageLike,
  withExpansion,
} from "./expansionMemory";

function storage(initial?: string): StorageLike & { read: () => string | null } {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_k, v) => {
      value = v;
    },
    read: () => value,
  };
}

describe("parseMemory", () => {
  it("reads a well-formed map", () => {
    expect(parseMemory({ "/repo": ["/repo/src"] })).toEqual({
      "/repo": ["/repo/src"],
    });
  });

  it("discards the pre-0.8.8 flat array format", () => {
    expect(parseMemory(["/repo/src", "/repo/lib"])).toEqual({});
  });

  it("drops non-string and empty entries", () => {
    expect(parseMemory({ "/repo": ["/repo/src", "", 5, null] })).toEqual({
      "/repo": ["/repo/src"],
    });
  });

  it("drops a root whose entries are all junk", () => {
    expect(parseMemory({ "/repo": [1, 2], "/other": ["/other/x"] })).toEqual({
      "/other": ["/other/x"],
    });
  });

  it("returns an empty map for junk input", () => {
    expect(parseMemory(null)).toEqual({});
    expect(parseMemory("nope")).toEqual({});
  });
});

describe("withExpansion", () => {
  it("does not mutate the input", () => {
    const before = { "/repo": ["/repo/a"] };
    withExpansion(before, "/repo", ["/repo/b"]);
    expect(before).toEqual({ "/repo": ["/repo/a"] });
  });

  it("replaces the entry for the given root and keeps others", () => {
    const out = withExpansion(
      { "/repo": ["/repo/a"], "/other": ["/other/x"] },
      "/repo",
      ["/repo/b"],
    );
    expect(out).toEqual({ "/repo": ["/repo/b"], "/other": ["/other/x"] });
  });

  it("drops a root once its set is empty", () => {
    expect(withExpansion({ "/repo": ["/repo/a"] }, "/repo", [])).toEqual({});
  });

  it("de-duplicates paths", () => {
    const out = withExpansion({}, "/repo", ["/repo/a", "/repo/a"]);
    expect(out["/repo"]).toEqual(["/repo/a"]);
  });

  it("caps the remembered folders per root", () => {
    const many = Array.from({ length: MAX_REMEMBERED + 10 }, (_, i) => `/r/${i}`);
    expect(withExpansion({}, "/r", many)["/r"]).toHaveLength(MAX_REMEMBERED);
  });

  it("evicts the stalest root, keeping the one just touched", () => {
    let memory = {};
    for (let i = 0; i < MAX_ROOTS + 3; i++) {
      memory = withExpansion(memory, `/root${i}`, [`/root${i}/a`]);
    }
    const roots = Object.keys(memory);
    expect(roots).toHaveLength(MAX_ROOTS);
    expect(roots[0]).toBe(`/root${MAX_ROOTS + 2}`);
    expect(roots).not.toContain("/root0");
  });
});

describe("recallExpansion / rememberExpansion", () => {
  it("round-trips the folders open under a root", () => {
    const s = storage();
    rememberExpansion("/repo", ["/repo/src", "/repo/src/lib"], s);
    expect(recallExpansion("/repo", s)).toEqual(
      new Set(["/repo/src", "/repo/src/lib"]),
    );
  });

  it("keeps roots separate", () => {
    const s = storage();
    rememberExpansion("/repo", ["/repo/src"], s);
    rememberExpansion("/other", ["/other/x"], s);
    expect(recallExpansion("/repo", s)).toEqual(new Set(["/repo/src"]));
    expect(recallExpansion("/other", s)).toEqual(new Set(["/other/x"]));
  });

  it("filters out paths that no longer sit under the root", () => {
    const s = storage(
      JSON.stringify({ "/repo": ["/repo/src", "/elsewhere/x"] }),
    );
    expect(recallExpansion("/repo", s)).toEqual(new Set(["/repo/src"]));
  });

  it("recognizes backslash-separated children of a Windows root", () => {
    const s = storage(
      JSON.stringify({ "C:\\repo": ["C:\\repo\\src", "D:\\other"] }),
    );
    expect(recallExpansion("C:\\repo", s)).toEqual(new Set(["C:\\repo\\src"]));
  });

  it("recalls nothing for an unknown root", () => {
    const s = storage(JSON.stringify({ "/repo": ["/repo/src"] }));
    expect(recallExpansion("/unknown", s)).toEqual(new Set());
  });

  it("survives corrupt storage", () => {
    expect(recallExpansion("/repo", storage("{not json"))).toEqual(new Set());
  });

  it("is a no-op without storage", () => {
    expect(() => rememberExpansion("/repo", ["/repo/a"], null)).not.toThrow();
    expect(recallExpansion("/repo", null)).toEqual(new Set());
  });
});
