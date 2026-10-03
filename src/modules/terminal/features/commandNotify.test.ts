import { describe, expect, it } from "vitest";
import {
  commandProgram,
  formatCommandNotification,
  shouldNotifyCommand,
  type NotifyContext,
} from "./commandNotify";

describe("commandProgram", () => {
  it.each([
    ["cargo build --release", "cargo"],
    ["FOO=1 BAR=2 npm test", "npm"],
    ["sudo -E nice -n 5 make -j8", "make"],
    ["/usr/bin/python3 script.py", "python3"],
    ["time env CI=1 pnpm build", "pnpm"],
    ["C:\\tools\\node.exe app.js", "node"],
    ["   ", null],
  ])("%s → %s", (cmd, expected) => {
    expect(commandProgram(cmd)).toBe(expected);
  });
});

describe("shouldNotifyCommand", () => {
  const base: NotifyContext = {
    command: "cargo build",
    exitCode: 0,
    durationMs: 30_000,
    thresholdMs: 10_000,
    windowFocused: false,
    paneVisible: true,
    ignore: ["vim", "ssh"],
  };

  it("notifies for slow commands while unfocused", () => {
    expect(shouldNotifyCommand(base)).toBe(true);
  });

  it("notifies when focused but the pane is hidden", () => {
    expect(shouldNotifyCommand({ ...base, windowFocused: true, paneVisible: false })).toBe(true);
  });

  it("stays quiet when the user is watching", () => {
    expect(shouldNotifyCommand({ ...base, windowFocused: true, paneVisible: true })).toBe(false);
  });

  it("stays quiet under the threshold or without timing", () => {
    expect(shouldNotifyCommand({ ...base, durationMs: 9_999 })).toBe(false);
    expect(shouldNotifyCommand({ ...base, durationMs: null })).toBe(false);
  });

  it("skips ignored interactive programs, even behind sudo", () => {
    expect(shouldNotifyCommand({ ...base, command: "sudo vim /etc/hosts" })).toBe(false);
  });
});

describe("formatCommandNotification", () => {
  it("reports success and failure", () => {
    expect(formatCommandNotification("make", 0, 65_000).title).toBe("Command finished · 1m 5s");
    expect(formatCommandNotification("make", 2, 2_000).title).toBe("Command failed (exit 2) · 2s");
  });

  it("truncates long commands", () => {
    const body = formatCommandNotification("x".repeat(500), 0, 1000).body;
    expect(body.length).toBe(118);
  });
});
