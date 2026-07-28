import type { Theme, ThemeMode } from "./types";

export type TerminalFont = {
  fontFamily: string;
  fontWeight: string;
  fontSize: number;
};

/**
 * Merge the user's terminal font preferences with any overrides the active
 * theme declares. Theme values win per-field, so a theme can pin just the
 * family and leave weight/size under user control.
 *
 * Falls back across variants (requested mode → dark → light) because a theme
 * may only define one of them.
 */
export function resolveTerminalFont(
  preferences: TerminalFont,
  theme: Theme,
  mode: ThemeMode,
): TerminalFont {
  const variant =
    theme.variants[mode] ?? theme.variants.dark ?? theme.variants.light;
  const terminal = variant?.terminal;
  return {
    fontFamily: terminal?.fontFamily ?? preferences.fontFamily,
    fontWeight: terminal?.fontWeight ?? preferences.fontWeight,
    fontSize: terminal?.fontSize ?? preferences.fontSize,
  };
}
