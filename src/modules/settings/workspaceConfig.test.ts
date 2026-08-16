import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();

vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    readFile: async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw new Error("ENOENT");
      return { kind: "text", content };
    },
    writeFile: async (path: string, content: string) => {
      files.set(path, content);
    },
    createDir: async () => {},
  },
}));

vi.mock("@/modules/ai/config", () => ({
  MODELS: [{ id: "claude" }],
}));

import { loadWorkspaceConfig, saveWorkspaceConfig } from "./workspaceConfig";

const ROOT = "/w";
const PATH = "/w/.gear/settings.json";

beforeEach(() => files.clear());

describe("loadWorkspaceConfig", () => {
  it("returns null when the file does not exist", async () => {
    expect(await loadWorkspaceConfig(ROOT)).toBeNull();
  });

  it("reads the run block into validated configs", async () => {
    files.set(
      PATH,
      JSON.stringify({
        run: { configs: [{ name: "Dev", command: "npm run dev" }] },
      }),
    );
    const config = await loadWorkspaceConfig(ROOT);
    expect(config?.run?.configs).toEqual([
      { id: "dev", name: "Dev", command: "npm run dev" },
    ]);
  });

  it("keeps valid entries and reports the invalid one", async () => {
    files.set(
      PATH,
      JSON.stringify({
        run: { configs: [{ name: "Dev", command: "x" }, { name: "broken" }] },
      }),
    );
    const config = await loadWorkspaceConfig(ROOT);
    expect(config?.run?.configs).toHaveLength(1);
    expect(config?.runErrors).toHaveLength(1);
  });

  it("still reads the other keys when there is no run block", async () => {
    files.set(PATH, JSON.stringify({ customInstructions: "be brief" }));
    const config = await loadWorkspaceConfig(ROOT);
    expect(config?.customInstructions).toBe("be brief");
    expect(config?.run).toBeUndefined();
  });

  it("survives malformed JSON rather than throwing", async () => {
    files.set(PATH, "{not json");
    expect(await loadWorkspaceConfig(ROOT)).toBeNull();
  });
});

describe("saveWorkspaceConfig", () => {
  it("preserves a hand-authored run block it did not write", async () => {
    const original = {
      run: { configs: [{ name: "Dev", command: "npm run dev" }] },
    };
    files.set(PATH, JSON.stringify(original));

    await saveWorkspaceConfig(ROOT, { customInstructions: "be brief" });

    const written = JSON.parse(files.get(PATH)!);
    expect(written.run).toEqual(original.run);
    expect(written.customInstructions).toBe("be brief");
  });

  it("preserves keys a future version might add", async () => {
    files.set(PATH, JSON.stringify({ futureKey: { a: 1 } }));
    await saveWorkspaceConfig(ROOT, { defaultModelId: "claude" });
    expect(JSON.parse(files.get(PATH)!).futureKey).toEqual({ a: 1 });
  });

  it("never writes derived runErrors back to disk", async () => {
    await saveWorkspaceConfig(ROOT, {
      customInstructions: "x",
      runErrors: ["some problem"],
    });
    expect(JSON.parse(files.get(PATH)!)).not.toHaveProperty("runErrors");
  });

  it("does not rewrite the run block from its parsed form", async () => {
    // Parsing derives ids and lowercases extensions; writing that back would
    // silently reformat a file the user hand-authored.
    files.set(PATH, JSON.stringify({ run: { configs: [{ name: "Dev", command: "x" }] } }));
    const loaded = await loadWorkspaceConfig(ROOT);
    await saveWorkspaceConfig(ROOT, { ...loaded, customInstructions: "y" });
    expect(JSON.parse(files.get(PATH)!).run.configs[0]).not.toHaveProperty("id");
  });

  it("writes a fresh file when none exists", async () => {
    await saveWorkspaceConfig(ROOT, { customInstructions: "hello" });
    expect(JSON.parse(files.get(PATH)!)).toEqual({ customInstructions: "hello" });
  });
});
