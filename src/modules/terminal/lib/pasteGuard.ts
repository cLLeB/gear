/**
 * Clipboard payloads are untrusted input. xterm.js wraps a paste in
 * `ESC [ 200 ~ … ESC [ 201 ~` when the shell enables bracketed paste, but it
 * does not check whether the payload itself contains the *terminator*. A
 * clipboard entry crafted as
 *
 *     git clone x\x1b[201~\nrm -rf ~\n
 *
 * therefore closes the bracket early and the rest lands on the shell as real
 * keystrokes — commands run without the user ever pressing Enter. The same
 * hole exists for bare control bytes (ESC sequences that retitle the window,
 * NUL, backspace-based visual spoofing).
 *
 * Everything pasted into a terminal goes through `sanitizePaste` first, and
 * `analyzePaste` decides whether the result is quiet enough to apply without
 * asking.
 */

/** Bracketed-paste start/end markers, in either 7-bit (ESC [) or 8-bit (CSI) form. */
const BRACKET_MARKER = /(?:\x1b\[|\x9b)20[01]~/g;

/** C0 controls except TAB/LF/CR, plus DEL. ESC is included — a paste never
 * legitimately needs to steer the emulator. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping controls is the point
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

export type PasteRisk = "safe" | "multiline" | "control";

export type PasteAnalysis = {
  /** The text that should actually reach the terminal. */
  text: string;
  /** Highest-severity finding; `safe` needs no confirmation. */
  risk: PasteRisk;
  /** Number of lines the shell will see. */
  lineCount: number;
  /** True when the payload ends in a newline, i.e. the last line auto-runs. */
  submits: boolean;
  /** True when sanitizing actually removed something. */
  modified: boolean;
};

/**
 * Strip anything that lets a paste act as control input rather than text.
 * Line endings are normalized to LF; xterm converts LF to CR on the way out.
 */
export function sanitizePaste(text: string): string {
  return text
    .replace(BRACKET_MARKER, "")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "");
}

/** Lines the shell will see. A single trailing newline does not add a line. */
export function pasteLineCount(text: string): number {
  if (text === "") return 0;
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body.split("\n").length;
}

export function analyzePaste(raw: string): PasteAnalysis {
  const text = sanitizePaste(raw);
  const modified = text !== raw.replace(/\r\n?/g, "\n");
  const lineCount = pasteLineCount(text);
  const submits = text.endsWith("\n");
  const risk: PasteRisk = modified
    ? "control"
    : lineCount > 1 || submits
      ? "multiline"
      : "safe";
  return { text, risk, lineCount, submits, modified };
}

/**
 * Alternate-screen apps (vim, fzf, a TUI installer) consume a paste as data,
 * not as a command line, so the multiline warning is noise there. Payloads
 * that carried control bytes are still worth flagging — they can repaint or
 * retitle the emulator regardless of which screen is active.
 */
export function pasteNeedsConfirmation(
  analysis: PasteAnalysis,
  opts: { isAlternateScreen: boolean },
): boolean {
  if (analysis.risk === "safe") return false;
  if (analysis.risk === "multiline" && opts.isAlternateScreen) return false;
  return true;
}
