import { stripAnsi } from "./stripAnsi";

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0xa4cf) || // CJK radicals … Yi
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility ideographs
    (code >= 0xfe30 && code <= 0xfe4f) || // CJK compatibility forms
    (code >= 0xff00 && code <= 0xff60) || // Fullwidth forms
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) || // emoji / symbols
    (code >= 0x20000 && code <= 0x3fffd) // CJK extension B+
  );
}

function isZeroWidth(code: number): boolean {
  return (
    code === 0x200b || // zero-width space
    (code >= 0x0300 && code <= 0x036f) || // combining diacritics
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe00 && code <= 0xfe0f) // variation selectors
  );
}

/**
 * Estimate the display width of a string in terminal cells, accounting for
 * wide CJK/emoji glyphs (2 cells), zero-width combining marks, and ANSI codes.
 */
export function stringWidth(input: string): number {
  const text = stripAnsi(input);
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code === 0) continue;
    if (isZeroWidth(code)) continue;
    width += isWide(code) ? 2 : 1;
  }
  return width;
}
