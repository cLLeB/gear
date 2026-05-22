import { readTerminalTokens } from "@/styles/tokens";
import type { ITheme } from "@xterm/xterm";

/** Semantic palette reused by the code editor. */
export const syntaxPalette = {
  comment: "#52525b",
  keyword: "#3b82f6",
  string: "#22c55e",
  number: "#eab308",
  constant: "#a855f7",
  fn: "#06b6d4",
  type: "#22d3ee",
  tag: "#ef4444",
  punctuation: "#a1a1aa",
  invalid: "#ef4444",
  link: "#3b82f6",
} as const;

/**
 * Builds an xterm theme at runtime from --terminal-* CSS custom properties.
 * Must be called after the DOM is ready; CSS variables are resolved via
 * getComputedStyle.
 */
export function buildTerminalTheme(): ITheme {
  const t = readTerminalTokens();
  return {
    background: t["background"],
    foreground: t["foreground"],
    cursor: t["cursor"],
    cursorAccent: t["cursor-accent"],
    selectionBackground: t["selection"],
    black: t["ansi-black"],
    red: t["ansi-red"],
    green: t["ansi-green"],
    yellow: t["ansi-yellow"],
    blue: t["ansi-blue"],
    magenta: t["ansi-magenta"],
    cyan: t["ansi-cyan"],
    white: t["ansi-white"],
    brightBlack: t["ansi-bright-black"],
    brightRed: t["ansi-bright-red"],
    brightGreen: t["ansi-bright-green"],
    brightYellow: t["ansi-bright-yellow"],
    brightBlue: t["ansi-bright-blue"],
    brightMagenta: t["ansi-bright-magenta"],
    brightCyan: t["ansi-bright-cyan"],
    brightWhite: t["ansi-bright-white"],
  };
}
