import { useMemo } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { resolveTerminalFont, useTheme } from "@/modules/theme";

/**
 * The terminal font actually in effect: the user's preferences with any
 * overrides declared by the active theme applied on top.
 */
export function useTerminalFont() {
  const fontFamily = usePreferencesStore((p) => p.terminalFontFamily);
  const fontWeight = usePreferencesStore((p) => p.terminalFontWeight);
  const fontSize = usePreferencesStore((p) => p.terminalFontSize);
  const { activeTheme, resolvedMode } = useTheme();

  return useMemo(
    () =>
      resolveTerminalFont(
        { fontFamily, fontWeight, fontSize },
        activeTheme,
        resolvedMode,
      ),
    [fontFamily, fontWeight, fontSize, activeTheme, resolvedMode],
  );
}
