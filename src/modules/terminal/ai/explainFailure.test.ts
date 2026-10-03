import { describe, expect, it } from "vitest";
import { buildFailureContext, failurePrompt, tailOutput } from "./explainFailure";

describe("tailOutput", () => {
  it("keeps the tail and marks the cut", () => {
    const out = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");
    expect(tailOutput(out, 3)).toBe("[… earlier output omitted …]\nline 7\nline 8\nline 9");
    expect(tailOutput("short", 3)).toBe("short");
  });
});

describe("buildFailureContext", () => {
  it("includes metadata and redacts secrets", () => {
    const text = buildFailureContext({
      command: "curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz' api",
      exitCode: 22,
      durationMs: 1500,
      output: "error: 401 for token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      cwd: "/repo",
    });
    expect(text).toContain("exit code: 22");
    expect(text).toContain("duration: 1s");
    expect(text).toContain("cwd: /repo");
    expect(text).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(text).not.toContain("abcdefghijklmnopqrstuvwxyz'");
  });

  it("handles silent commands", () => {
    expect(buildFailureContext({ command: "false", exitCode: 1, durationMs: null, output: "", cwd: null })).toBe("$ false\nexit code: 1\n\n(no output)");
  });

  it("asks for a fix only when the command failed", () => {
    expect(failurePrompt({ command: "x", exitCode: 2, durationMs: null, output: null, cwd: null })).toMatch(/failed/);
    expect(failurePrompt({ command: "x", exitCode: 0, durationMs: null, output: null, cwd: null })).toMatch(/Explain what/);
  });
});
