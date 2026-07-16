import type { RGB } from "./color";

const ESC = String.fromCharCode(27);
const RESET = `${ESC}[0m`;

/** Wrap text in an SGR sequence with the given numeric codes. */
export function sgr(text: string, ...codes: number[]): string {
  return `${ESC}[${codes.join(";")}m${text}${RESET}`;
}

export const bold = (t: string) => sgr(t, 1);
export const dim = (t: string) => sgr(t, 2);
export const italic = (t: string) => sgr(t, 3);
export const underline = (t: string) => sgr(t, 4);
export const inverse = (t: string) => sgr(t, 7);
export const strikethrough = (t: string) => sgr(t, 9);

/** Colorize text with a 256-color foreground index. */
export function fg256(text: string, index: number): string {
  return sgr(text, 38, 5, index);
}

/** Colorize text with a 256-color background index. */
export function bg256(text: string, index: number): string {
  return sgr(text, 48, 5, index);
}

/** Colorize text with a 24-bit truecolor foreground. */
export function fgRgb(text: string, { r, g, b }: RGB): string {
  return sgr(text, 38, 2, r, g, b);
}

/**
 * Build an OSC 8 terminal hyperlink so `label` opens `url` when clicked in a
 * supporting terminal.
 */
export function hyperlink(url: string, label = url): string {
  const OSC = `${ESC}]8;;`;
  const BEL = String.fromCharCode(7);
  return `${OSC}${url}${BEL}${label}${OSC}${BEL}`;
}
