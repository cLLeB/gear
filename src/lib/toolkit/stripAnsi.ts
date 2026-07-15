// Matches CSI, OSC, and single-character ANSI escape sequences commonly found
// in terminal output. Kept as a single compiled regex for hot-path use.
const ANSI_PATTERN = new RegExp(
  [
    "[\\u001B\\u009B][[\\]()#;?]*",
    "(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
    "|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))",
  ].join(""),
  "g",
);

/**
 * Remove ANSI escape / color sequences from a string, leaving plain text.
 * Useful for measuring visible width, copying clean output, or searching logs.
 */
export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, "");
}

/** True when the string contains at least one ANSI escape sequence. */
export function hasAnsi(input: string): boolean {
  ANSI_PATTERN.lastIndex = 0;
  return ANSI_PATTERN.test(input);
}
