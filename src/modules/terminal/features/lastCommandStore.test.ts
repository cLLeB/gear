import { describe, expect, it } from "vitest";
import { formatDurationShort, useLastCommandStore } from "./lastCommandStore";

describe("formatDurationShort", () => {
  it.each([
    [250, "250ms"],
    [1234, "1.2s"],
    [45_000, "45s"],
    [185_000, "3m 05s"],
    [3_720_000, "1h 02m"],
  ])("%d → %s", (ms, text) => {
    expect(formatDurationShort(ms)).toBe(text);
  });
});

describe("useLastCommandStore", () => {
  it("records per pane and tracks the active pane", () => {
    useLastCommandStore.getState().record(3, { command: "ls", exitCode: 0, durationMs: 5, finishedAt: 1 });
    useLastCommandStore.getState().setActiveLeaf(3);
    const s = useLastCommandStore.getState();
    expect(s.byLeaf[3].command).toBe("ls");
    expect(s.activeLeaf).toBe(3);
  });
});
