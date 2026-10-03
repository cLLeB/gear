import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "macos" }));

describe("default shortcuts on macOS", () => {
  it("have no conflicts", async () => {
    const { SHORTCUTS } = await import("./shortcuts");
    const { findShortcutConflicts } = await import("./conflicts");
    expect(findShortcutConflicts(SHORTCUTS)).toEqual([]);
  });
});
