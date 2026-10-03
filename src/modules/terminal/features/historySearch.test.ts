import { describe, expect, it } from "vitest";
import { extractCmdPayload, mergeHistory } from "./historySearch";

describe("extractCmdPayload", () => {
  it("handles tagged and flat payloads", () => {
    expect(extractCmdPayload({ Cmd: { command: "ls", exit_code: 0, duration_ms: 3 } })).toEqual({ command: "ls", exitCode: 0, durationMs: 3 });
    expect(extractCmdPayload({ type: "cmd", command: "pwd", exit_code: null })).toEqual({ command: "pwd", exitCode: null, durationMs: null });
    expect(extractCmdPayload({ File: { path: "x" } })).toBeNull();
  });
});

describe("mergeHistory", () => {
  const NOW = 10_000_000_000;
  it("dedupes, keeps the latest status and ranks by frecency", () => {
    const merged = mergeHistory(
      [
        { ts: NOW - 100_000_000, command: "npm test", exitCode: 1, durationMs: 9000 },
        { ts: NOW - 60_000, command: "npm test", exitCode: 0, durationMs: 8000 },
        { ts: NOW - 30 * 86_400_000, command: "make release", exitCode: 0, durationMs: 1 },
      ],
      ["git status", "npm test", "ls"],
      NOW,
    );
    expect(merged[0]).toMatchObject({ command: "npm test", count: 3, lastExit: 0, lastDurationMs: 8000, source: "workspace" });
    expect(merged.map((m) => m.command)).toContain("git status");
    expect(merged.filter((m) => m.command === "npm test")).toHaveLength(1);
  });
});
