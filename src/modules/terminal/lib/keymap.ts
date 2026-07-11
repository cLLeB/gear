export type TerminalKeyEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "key" | "code"
>;

export type PlatformOpts = { isMac: boolean };

/** PowerShell is the only Windows shell where plain Ctrl+C / Ctrl+V map to
 * copy/paste; bash/cmd keep the Ctrl+Shift variants. An unset shellPath on
 * Windows resolves to the built-in PowerShell default, so treat it as PS. */
export function isPowerShellShellPath(
  shellPath: string | null | undefined,
  isWindows: boolean,
): boolean {
  if (!shellPath) return isWindows;
  const base =
    shellPath.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  return (
    base === "pwsh" ||
    base === "pwsh.exe" ||
    base === "powershell" ||
    base === "powershell.exe"
  );
}

export type TerminalClipboardIntent = "copy" | "paste" | null;

/** Classify a copy/paste key combo for the terminal:
 *   Ctrl+Shift+C / Ctrl+Shift+V — every shell (universal, unchanged).
 *   Ctrl+C / Ctrl+V (no Shift)  — PowerShell only.
 * This only classifies the combo. The caller must still let a plain Ctrl+C
 * with no active selection fall through to the PTY as SIGINT. */
export function terminalClipboardIntent(
  event: TerminalKeyEvent,
  opts: { isMac: boolean; powerShell: boolean },
): TerminalClipboardIntent {
  if (opts.isMac) return null;
  if (!event.ctrlKey || event.altKey || event.metaKey) return null;
  const isCopy =
    event.code === "KeyC" || event.key === "c" || event.key === "C";
  const isPaste =
    event.code === "KeyV" || event.key === "v" || event.key === "V";
  if (!isCopy && !isPaste) return null;
  if (!event.shiftKey && !opts.powerShell) return null;
  return isCopy ? "copy" : "paste";
}

export function terminalWordNavigationSequence(event: TerminalKeyEvent): string | null {
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "ArrowLeft" || event.code === "ArrowLeft") return "\x1bb";
  if (event.key === "ArrowRight" || event.code === "ArrowRight") return "\x1bf";
  return null;
}

/** Cmd+Left/Right → readline line-start (Ctrl+A) / line-end (Ctrl+E).
 * macOS-only — Cmd doesn't exist as a navigation modifier elsewhere. */
export function terminalLineNavigationSequence(
  event: TerminalKeyEvent,
  opts: PlatformOpts,
): string | null {
  if (!opts.isMac) return null;
  if (!event.metaKey || event.altKey || event.ctrlKey) return null;
  if (event.key === "ArrowLeft" || event.code === "ArrowLeft") return "\x01";
  if (event.key === "ArrowRight" || event.code === "ArrowRight") return "\x05";
  return null;
}

/** Modifier+Backspace deletion:
 *   macOS  Cmd+Backspace    → Ctrl+U (kill-to-line-start)
 *   macOS  Option+Backspace → Ctrl+W (kill-word-backward)
 *   Other  Ctrl+Backspace   → Ctrl+W (kill-word-backward)
 */
export function terminalDeleteSequence(
  event: TerminalKeyEvent,
  opts: PlatformOpts,
): string | null {
  if (event.key !== "Backspace" && event.code !== "Backspace") return null;
  if (opts.isMac) {
    if (event.metaKey && !event.altKey && !event.ctrlKey) return "\x15";
    if (event.altKey && !event.metaKey && !event.ctrlKey) return "\x17";
    return null;
  }
  if (event.ctrlKey && !event.altKey && !event.metaKey) return "\x17";
  return null;
}
