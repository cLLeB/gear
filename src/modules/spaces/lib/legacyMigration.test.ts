import { describe, expect, it } from "vitest";
import {
  clearLegacySession,
  readLegacySession,
  type StorageLike,
} from "./legacyMigration";

function storage(entries: Record<string, string>): StorageLike & {
  keys: () => string[];
} {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (k) => map.get(k) ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    keys: () => [...map.keys()],
  };
}

describe("readLegacySession", () => {
  it("returns null when there is nothing to migrate", () => {
    expect(readLegacySession("default", storage({}))).toBeNull();
  });

  it("returns null when storage is unavailable", () => {
    expect(readLegacySession("default", null)).toBeNull();
  });

  it("converts terminals and editors into serialized tabs", () => {
    const s = storage({
      "Gear.terminal.sessions": JSON.stringify([
        { title: "shell", cwd: "/a" },
        { title: "shell", cwd: "/b" },
      ]),
      "Gear.editor.sessions": JSON.stringify(["/a/x.ts"]),
    });
    const out = readLegacySession("default", s);
    expect(out?.tabsBySpace.get("default")).toEqual([
      { kind: "terminal", tree: { kind: "leaf", cwd: "/a" } },
      { kind: "terminal", tree: { kind: "leaf", cwd: "/b" } },
      { kind: "editor", path: "/a/x.ts" },
    ]);
  });

  it("keeps the first terminal, which the old restore path dropped", () => {
    const s = storage({
      "Gear.terminal.sessions": JSON.stringify([{ title: "shell", cwd: "/a" }]),
    });
    expect(readLegacySession("default", s)?.tabsBySpace.get("default")).toEqual([
      { kind: "terminal", tree: { kind: "leaf", cwd: "/a" } },
    ]);
  });

  it("strips the Windows extended-length prefix from a saved cwd", () => {
    const s = storage({
      "Gear.terminal.sessions": JSON.stringify([
        { title: "shell", cwd: "//?/C:/Users/x" },
      ]),
    });
    expect(readLegacySession("default", s)?.tabsBySpace.get("default")).toEqual([
      { kind: "terminal", tree: { kind: "leaf", cwd: "C:/Users/x" } },
    ]);
  });

  it("groups terminals by their recorded space", () => {
    const s = storage({
      "Gear.terminal.sessions": JSON.stringify([
        { title: "shell", cwd: "/a", spaceId: "sp-2" },
        { title: "shell", cwd: "/b" },
      ]),
      "Gear.spaces.meta": JSON.stringify({ spaces: [], activeId: "sp-2" }),
    });
    const out = readLegacySession("default", s);
    expect([...(out?.tabsBySpace.keys() ?? [])].sort()).toEqual([
      "default",
      "sp-2",
    ]);
    expect(out?.activeSpaceId).toBe("sp-2");
  });

  it("survives malformed json and malformed entries", () => {
    const s = storage({
      "Gear.terminal.sessions": "{not json",
      "Gear.editor.sessions": JSON.stringify(["/a/x.ts", "", 42, null]),
    });
    expect(readLegacySession("default", s)?.tabsBySpace.get("default")).toEqual([
      { kind: "editor", path: "/a/x.ts" },
    ]);
  });
});

describe("clearLegacySession", () => {
  it("removes all three legacy keys and leaves others alone", () => {
    const s = storage({
      "Gear.terminal.sessions": "[]",
      "Gear.editor.sessions": "[]",
      "Gear.spaces.meta": "{}",
      "Gear.other": "keep",
    });
    clearLegacySession(s);
    expect(s.keys()).toEqual(["Gear.other"]);
  });

  it("is a no-op when storage is unavailable", () => {
    expect(() => clearLegacySession(null)).not.toThrow();
  });
});
