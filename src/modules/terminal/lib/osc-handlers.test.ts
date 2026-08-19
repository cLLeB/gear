import { describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import {
  createShellIntegrationState,
  osc52Decision,
  registerCwdHandler,
  registerOsc52ClipboardHandler,
  registerPromptTracker,
} from "./osc-handlers";

// git-bash path mapping is Windows-only; exercise that branch.
vi.mock("@/lib/platform", () => ({ IS_WINDOWS: true }));

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

async function flushClipboardQueue() {
  await Promise.resolve();
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

  it("maps git-bash /c/ cwd to a Windows drive path", () => {
    const { term, handlers } = makeFakeTerm();
    const state = createShellIntegrationState();
    const onCwd = vi.fn();
    registerPromptTracker(term, state);
    registerCwdHandler(term, onCwd, state);

    handlers.get(133)?.("A");
    handlers.get(7)?.("file:///c/Users/leo/project");

    expect(onCwd).toHaveBeenCalledWith("C:/Users/leo/project");
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
});

describe("OSC 133 command-state tracking", () => {
  it("reports running only between C and D, not while typing at the prompt", () => {
    const { term, handlers } = makeFakeTerm();
    const onCommandState = vi.fn();
    registerPromptTracker(term, undefined, onCommandState);

    handlers.get(133)?.("A");
    expect(onCommandState).toHaveBeenLastCalledWith(false);
    handlers.get(133)?.("B");
    expect(onCommandState).toHaveBeenCalledTimes(1);
    handlers.get(133)?.("C;claude");
    expect(onCommandState).toHaveBeenLastCalledWith(true);
    handlers.get(133)?.("D;0");
    expect(onCommandState).toHaveBeenLastCalledWith(false);
  });

  it("clears running state on a bare new prompt when D was lost", () => {
    const { term, handlers } = makeFakeTerm();
    const onCommandState = vi.fn();
    registerPromptTracker(term, undefined, onCommandState);

    handlers.get(133)?.("C;vim");
    expect(onCommandState).toHaveBeenLastCalledWith(true);
    handlers.get(133)?.("A");
    expect(onCommandState).toHaveBeenLastCalledWith(false);
  });
});

describe("OSC 52 clipboard handler", () => {
  it("writes decoded clipboard payloads", async () => {
    const { term, handlers } = makeFakeTerm();
    const writeClipboard = vi.fn();
    registerOsc52ClipboardHandler(term, writeClipboard);

    const result = handlers.get(52)?.("c;SGVsbG8=");
    await flushClipboardQueue();

    expect(result).toBe(true);
    expect(writeClipboard).toHaveBeenCalledWith("Hello");
  });

  it("decodes UTF-8 payloads", async () => {
    const { term, handlers } = makeFakeTerm();
    const writeClipboard = vi.fn();
    registerOsc52ClipboardHandler(term, writeClipboard);

    handlers.get(52)?.("c;8J+YgCBtZXJoYWJh");
    await flushClipboardQueue();

    expect(writeClipboard).toHaveBeenCalledWith("😀 merhaba");
  });

  it("does not block the parser on clipboard writes", async () => {
    const { term, handlers } = makeFakeTerm();
    const writeClipboard = vi.fn(() => new Promise<void>(() => {}));
    registerOsc52ClipboardHandler(term, writeClipboard);

    const result = handlers.get(52)?.("c;SGVsbG8=");

    expect(result).toBe(true);
    expect(writeClipboard).not.toHaveBeenCalled();
    await flushClipboardQueue();
    expect(writeClipboard).toHaveBeenCalledWith("Hello");
  });

  it("ignores primary-selection-only payloads", async () => {
    const { term, handlers } = makeFakeTerm();
    const writeClipboard = vi.fn();
    registerOsc52ClipboardHandler(term, writeClipboard);

    await handlers.get(52)?.("p;SGVsbG8=");
    await flushClipboardQueue();

    expect(writeClipboard).not.toHaveBeenCalled();
  });

  it("ignores clipboard queries and malformed payloads", async () => {
    const { term, handlers } = makeFakeTerm();
    const writeClipboard = vi.fn();
    registerOsc52ClipboardHandler(term, writeClipboard);

    await handlers.get(52)?.("c;?");
    await handlers.get(52)?.("c;not base64!");
    await handlers.get(52)?.("s;SGVsbG8=");
    await flushClipboardQueue();

    expect(writeClipboard).not.toHaveBeenCalled();
  });

  it("ignores oversized payloads", async () => {
    const { term, handlers } = makeFakeTerm();
    const writeClipboard = vi.fn();
    registerOsc52ClipboardHandler(term, writeClipboard);

    await handlers.get(52)?.(`c;${"A".repeat(1_398_110)}`);
    await flushClipboardQueue();

    expect(writeClipboard).not.toHaveBeenCalled();
  });
});

describe("OSC 52 provenance gate", () => {
  it("allows anything a full-screen app yanks", () => {
    expect(
      osc52Decision({ isAlternateScreen: true, inCommand: true }),
    ).toBe("allow");
  });

  it("allows writes the shell makes between commands", () => {
    expect(
      osc52Decision({ isAlternateScreen: false, inCommand: false }),
    ).toBe("allow");
  });

  it("asks before letting running command output take the clipboard", () => {
    expect(
      osc52Decision({ isAlternateScreen: false, inCommand: true }),
    ).toBe("confirm");
  });

  it("routes an in-command payload to the confirmation hook, not the clipboard", async () => {
    const { term, handlers } = makeFakeTerm();
    const writeClipboard = vi.fn();
    const onConfirm = vi.fn();
    const state = createShellIntegrationState();
    registerPromptTracker(term, state);
    registerOsc52ClipboardHandler(term, writeClipboard, {
      state,
      isAlternateScreen: () => false,
      onConfirm,
    });

    handlers.get(133)?.("C;curl evil.sh");
    handlers.get(52)?.("c;SGVsbG8=");
    await flushClipboardQueue();

    expect(writeClipboard).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledWith("Hello", expect.any(Function));
  });

  it("performs the write once the user opts in", async () => {
    const { term, handlers } = makeFakeTerm();
    const writeClipboard = vi.fn();
    const applied: (() => void)[] = [];
    const state = createShellIntegrationState();
    registerPromptTracker(term, state);
    registerOsc52ClipboardHandler(term, writeClipboard, {
      state,
      isAlternateScreen: () => false,
      onConfirm: (_text, fn) => {
        applied.push(fn);
      },
    });

    handlers.get(133)?.("C;curl evil.sh");
    handlers.get(52)?.("c;SGVsbG8=");
    await flushClipboardQueue();
    for (const fn of applied) fn();
    await flushClipboardQueue();

    expect(writeClipboard).toHaveBeenCalledWith("Hello");
  });

  it("still writes directly while a full-screen app owns the screen", async () => {
    const { term, handlers } = makeFakeTerm();
    const writeClipboard = vi.fn();
    const onConfirm = vi.fn();
    const state = createShellIntegrationState();
    registerPromptTracker(term, state);
    registerOsc52ClipboardHandler(term, writeClipboard, {
      state,
      isAlternateScreen: () => true,
      onConfirm,
    });

    handlers.get(133)?.("C;nvim");
    handlers.get(52)?.("c;SGVsbG8=");
    await flushClipboardQueue();

    expect(onConfirm).not.toHaveBeenCalled();
    expect(writeClipboard).toHaveBeenCalledWith("Hello");
  });

  it("writes without asking when no shell integration state is supplied", async () => {
    const { term, handlers } = makeFakeTerm();
    const writeClipboard = vi.fn();
    registerOsc52ClipboardHandler(term, writeClipboard);

    handlers.get(52)?.("c;SGVsbG8=");
    await flushClipboardQueue();

    expect(writeClipboard).toHaveBeenCalledWith("Hello");
  });
});
