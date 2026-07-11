import { describe, expect, it } from "vitest";

import {
  isPowerShellShellPath,
  terminalClipboardIntent,
  terminalDeleteSequence,
  terminalLineNavigationSequence,
  terminalWordNavigationSequence,
  type TerminalKeyEvent,
} from "./keymap";

const evt = (partial: Partial<TerminalKeyEvent>): TerminalKeyEvent => ({
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  key: "",
  code: "",
  ...partial,
});

describe("terminalWordNavigationSequence", () => {
  it("maps Option+Left to readline word-left", () => {
    expect(
      terminalWordNavigationSequence(
        evt({ altKey: true, key: "ArrowLeft", code: "ArrowLeft" }),
      ),
    ).toBe("\x1bb");
  });

  it("maps Option+Right to readline word-right", () => {
    expect(
      terminalWordNavigationSequence(
        evt({ altKey: true, key: "ArrowRight", code: "ArrowRight" }),
      ),
    ).toBe("\x1bf");
  });

  it("does not remap plain arrows", () => {
    expect(
      terminalWordNavigationSequence(
        evt({ key: "ArrowLeft", code: "ArrowLeft" }),
      ),
    ).toBeNull();
  });
});

describe("terminalLineNavigationSequence", () => {
  it("maps Cmd+Left to readline line-start on macOS", () => {
    expect(
      terminalLineNavigationSequence(
        evt({ metaKey: true, key: "ArrowLeft", code: "ArrowLeft" }),
        { isMac: true },
      ),
    ).toBe("\x01");
  });

  it("maps Cmd+Right to readline line-end on macOS", () => {
    expect(
      terminalLineNavigationSequence(
        evt({ metaKey: true, key: "ArrowRight", code: "ArrowRight" }),
        { isMac: true },
      ),
    ).toBe("\x05");
  });

  it("does not remap Cmd+Arrow off macOS", () => {
    expect(
      terminalLineNavigationSequence(
        evt({ metaKey: true, key: "ArrowLeft", code: "ArrowLeft" }),
        { isMac: false },
      ),
    ).toBeNull();
  });

  it("does not remap Cmd+Option+Arrow (selection-style combos pass through)", () => {
    expect(
      terminalLineNavigationSequence(
        evt({ metaKey: true, altKey: true, key: "ArrowLeft", code: "ArrowLeft" }),
        { isMac: true },
      ),
    ).toBeNull();
  });
});

describe("terminalDeleteSequence", () => {
  it("maps Cmd+Backspace to kill-to-line-start on macOS", () => {
    expect(
      terminalDeleteSequence(
        evt({ metaKey: true, key: "Backspace", code: "Backspace" }),
        { isMac: true },
      ),
    ).toBe("\x15");
  });

  it("maps Option+Backspace to kill-word-backward on macOS", () => {
    expect(
      terminalDeleteSequence(
        evt({ altKey: true, key: "Backspace", code: "Backspace" }),
        { isMac: true },
      ),
    ).toBe("\x17");
  });

  it("maps Ctrl+Backspace to kill-word-backward off macOS", () => {
    expect(
      terminalDeleteSequence(
        evt({ ctrlKey: true, key: "Backspace", code: "Backspace" }),
        { isMac: false },
      ),
    ).toBe("\x17");
  });

  it("does not remap Ctrl+Backspace on macOS (reserved for native readline binding)", () => {
    expect(
      terminalDeleteSequence(
        evt({ ctrlKey: true, key: "Backspace", code: "Backspace" }),
        { isMac: true },
      ),
    ).toBeNull();
  });

  it("does not remap Cmd+Backspace off macOS", () => {
    expect(
      terminalDeleteSequence(
        evt({ metaKey: true, key: "Backspace", code: "Backspace" }),
        { isMac: false },
      ),
    ).toBeNull();
  });

  it("does not remap plain Backspace", () => {
    expect(
      terminalDeleteSequence(
        evt({ key: "Backspace", code: "Backspace" }),
        { isMac: true },
      ),
    ).toBeNull();
  });
});

describe("isPowerShellShellPath", () => {
  it("matches pwsh / powershell by basename regardless of separators", () => {
    expect(isPowerShellShellPath("C:\\Program Files\\PowerShell\\7\\pwsh.exe", true)).toBe(true);
    expect(isPowerShellShellPath("C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe", true)).toBe(true);
    expect(isPowerShellShellPath("/usr/bin/pwsh", false)).toBe(true);
  });

  it("treats an unset shell as PowerShell only on Windows (the built-in default)", () => {
    expect(isPowerShellShellPath(undefined, true)).toBe(true);
    expect(isPowerShellShellPath("", true)).toBe(true);
    expect(isPowerShellShellPath(undefined, false)).toBe(false);
  });

  it("does not match bash / cmd / other shells", () => {
    expect(isPowerShellShellPath("C:\\Program Files\\Git\\bin\\bash.exe", true)).toBe(false);
    expect(isPowerShellShellPath("C:\\Windows\\System32\\cmd.exe", true)).toBe(false);
    expect(isPowerShellShellPath("/bin/zsh", false)).toBe(false);
  });
});

describe("terminalClipboardIntent", () => {
  const copy = { key: "c", code: "KeyC" };
  const paste = { key: "v", code: "KeyV" };

  it("classifies Ctrl+Shift+C/V as copy/paste in any shell", () => {
    expect(
      terminalClipboardIntent(evt({ ctrlKey: true, shiftKey: true, ...copy }), {
        isMac: false,
        powerShell: false,
      }),
    ).toBe("copy");
    expect(
      terminalClipboardIntent(evt({ ctrlKey: true, shiftKey: true, ...paste }), {
        isMac: false,
        powerShell: false,
      }),
    ).toBe("paste");
  });

  it("classifies plain Ctrl+C/V as copy/paste in PowerShell", () => {
    expect(
      terminalClipboardIntent(evt({ ctrlKey: true, ...copy }), {
        isMac: false,
        powerShell: true,
      }),
    ).toBe("copy");
    expect(
      terminalClipboardIntent(evt({ ctrlKey: true, ...paste }), {
        isMac: false,
        powerShell: true,
      }),
    ).toBe("paste");
  });

  it("leaves plain Ctrl+C/V alone in non-PowerShell shells (bash keeps SIGINT/no-op)", () => {
    expect(
      terminalClipboardIntent(evt({ ctrlKey: true, ...copy }), {
        isMac: false,
        powerShell: false,
      }),
    ).toBeNull();
    expect(
      terminalClipboardIntent(evt({ ctrlKey: true, ...paste }), {
        isMac: false,
        powerShell: false,
      }),
    ).toBeNull();
  });

  it("never intercepts on macOS", () => {
    expect(
      terminalClipboardIntent(evt({ ctrlKey: true, shiftKey: true, ...copy }), {
        isMac: true,
        powerShell: true,
      }),
    ).toBeNull();
  });

  it("ignores Ctrl+Alt / other keys", () => {
    expect(
      terminalClipboardIntent(evt({ ctrlKey: true, altKey: true, ...copy }), {
        isMac: false,
        powerShell: true,
      }),
    ).toBeNull();
    expect(
      terminalClipboardIntent(evt({ ctrlKey: true, key: "a", code: "KeyA" }), {
        isMac: false,
        powerShell: true,
      }),
    ).toBeNull();
  });
});
