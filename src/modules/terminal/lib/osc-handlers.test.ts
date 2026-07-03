import { describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import {
  createShellIntegrationState,
  parseOsc133Field,
  registerCwdHandler,
  registerPromptTracker,
} from "./osc-handlers";

/**
 * Minimal in-memory fake of the xterm `Terminal` surface we touch — just
 * enough to register OSC handlers and invoke them with crafted payloads.
 * The OSC handler signature is `(data: string) => boolean | Promise<boolean>`.
 */
type OscHandler = (data: string) => boolean | Promise<boolean>;

function makeFakeTerm() {
  const handlers = new Map<number, OscHandler>();
  const term = {
    parser: {
      registerOscHandler(code: number, handler: OscHandler) {
        handlers.set(code, handler);
        return { dispose: () => handlers.delete(code) };
      },
    },
    registerMarker: vi.fn().mockReturnValue({ isDisposed: false, dispose: vi.fn() }),
  } as unknown as Terminal;
  return { term, handlers };
}

describe("OSC 7 cwd handler — gated by OSC 133 in-command state", () => {
  it("accepts OSC 7 when no command is running", () => {
    const { term, handlers } = makeFakeTerm();
    const state = createShellIntegrationState();
    const onCwd = vi.fn();
    registerPromptTracker(term, state);
    registerCwdHandler(term, onCwd, state);

    // OSC 133 A means "new prompt is about to be drawn" — we're between
    // commands and OSC 7 from the shell is legitimate here.
    handlers.get(133)?.("A");
    handlers.get(7)?.("file://host/home/me/project");

    expect(onCwd).toHaveBeenCalledWith("/home/me/project");
  });

  it("rejects OSC 7 emitted while a command is running", () => {
    const { term, handlers } = makeFakeTerm();
    const state = createShellIntegrationState();
    const onCwd = vi.fn();
    registerPromptTracker(term, state);
    registerCwdHandler(term, onCwd, state);

    // Simulate: user runs `ssh attacker.host`, which prints attacker bytes
    // including an OSC 7 trying to silently move the AI's cwd into /etc.
    handlers.get(133)?.("A"); // prompt drawn
    handlers.get(133)?.("B"); // command begins (user hit enter)
    handlers.get(7)?.("file://host/etc"); // attacker injection

    expect(onCwd).not.toHaveBeenCalled();
  });

  it("re-accepts OSC 7 after command finishes (OSC 133 D)", () => {
    const { term, handlers } = makeFakeTerm();
    const state = createShellIntegrationState();
    const onCwd = vi.fn();
    registerPromptTracker(term, state);
    registerCwdHandler(term, onCwd, state);

    handlers.get(133)?.("A");
    handlers.get(133)?.("B"); // running
    handlers.get(7)?.("file://host/etc"); // blocked
    handlers.get(133)?.("D;0"); // command exited
    handlers.get(7)?.("file://host/home/me/new-cwd"); // legitimate post-cmd OSC 7

    expect(onCwd).toHaveBeenCalledTimes(1);
    expect(onCwd).toHaveBeenCalledWith("/home/me/new-cwd");
  });

  it("works without state for backwards compatibility (legacy callers)", () => {
    // The state parameter is optional — when omitted, OSC 7 is always
    // honored (legacy behavior). Tests must confirm we didn't break this.
    const { term, handlers } = makeFakeTerm();
    const onCwd = vi.fn();
    registerCwdHandler(term, onCwd);

    handlers.get(7)?.("file://host/home/me/project");
    expect(onCwd).toHaveBeenCalledWith("/home/me/project");
  });

  it("normalizes Windows drive-letter OSC 7 paths", () => {
    const { term, handlers } = makeFakeTerm();
    const onCwd = vi.fn();
    registerCwdHandler(term, onCwd);

    handlers.get(7)?.("file:///C:/Users/me/project");
    expect(onCwd).toHaveBeenCalledWith("C:/Users/me/project");
  });

  it("normalizes Git Bash / MSYS2 POSIX-style OSC 7 paths", () => {
    // Git Bash emits /c/Users/me/project (lowercase drive, no colon).
    // The file explorer must receive C:/Users/me/project.
    const { term, handlers } = makeFakeTerm();
    const onCwd = vi.fn();
    registerCwdHandler(term, onCwd);

    handlers.get(7)?.("file://HOSTNAME/c/Users/me/project");
    expect(onCwd).toHaveBeenCalledWith("C:/Users/me/project");
  });
});

describe("parseOsc133Field", () => {
  it("returns the text after the first semicolon", () => {
    expect(parseOsc133Field("C;git status")).toBe("git status");
    expect(parseOsc133Field("D;0")).toBe("0");
  });

  it("returns empty string when there is no field", () => {
    expect(parseOsc133Field("C")).toBe("");
    expect(parseOsc133Field("D")).toBe("");
  });
});

describe("registerPromptTracker — command capture", () => {
  it("fires onCommand at D with command text and exit code", () => {
    const { term, handlers } = makeFakeTerm();
    const onCommand = vi.fn();
    registerPromptTracker(term, createShellIntegrationState(), onCommand);

    handlers.get(133)?.("A");
    handlers.get(133)?.("C;npm test");
    handlers.get(133)?.("D;1");

    expect(onCommand).toHaveBeenCalledTimes(1);
    const rec = onCommand.mock.calls[0][0];
    expect(rec.command).toBe("npm test");
    expect(rec.exitCode).toBe(1);
    expect(typeof rec.durationMs === "number" || rec.durationMs === null).toBe(
      true,
    );
  });

  it("reports null exit code when D carries no status", () => {
    const { term, handlers } = makeFakeTerm();
    const onCommand = vi.fn();
    registerPromptTracker(term, createShellIntegrationState(), onCommand);

    handlers.get(133)?.("C;ls");
    handlers.get(133)?.("D");

    expect(onCommand.mock.calls[0][0].exitCode).toBeNull();
  });

  it("does not fire onCommand for prompt/begin markers", () => {
    const { term, handlers } = makeFakeTerm();
    const onCommand = vi.fn();
    registerPromptTracker(term, createShellIntegrationState(), onCommand);

    handlers.get(133)?.("A");
    handlers.get(133)?.("B");
    expect(onCommand).not.toHaveBeenCalled();
  });
});
