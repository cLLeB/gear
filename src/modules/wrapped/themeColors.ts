// The active theme's colours, read live from its CSS variables, so drawings on
// a canvas (the share card, the confetti) match the theme the app is wearing,
// light or dark, built-in or custom.

export interface ThemeColors {
  background: string;
  card: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  primary: string;
  primaryForeground: string;
  border: string;
  /** The theme's chart colours, for confetti. */
  palette: string[];
}

export function themeColors(): ThemeColors {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const primary = v("--primary", "#888");
  return {
    background: v("--background", "#111"),
    card: v("--card", v("--background", "#111")),
    foreground: v("--foreground", "#eee"),
    muted: v("--muted", "#333"),
    mutedForeground: v("--muted-foreground", "#999"),
    primary,
    primaryForeground: v("--primary-foreground", "#fff"),
    border: v("--border", "#444"),
    palette: [primary, ...[1, 2, 3, 4, 5].map((i) => v(`--chart-${i}`, "")).filter(Boolean), v("--foreground", "#eee")],
  };
}
