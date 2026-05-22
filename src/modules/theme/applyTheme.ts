import type { Theme, ThemeMode } from "./types";

const COLOR_VAR_MAP: Record<string, string> = {
  background: "--background",
  foreground: "--foreground",
  card: "--card",
  cardForeground: "--card-foreground",
  popover: "--popover",
  popoverForeground: "--popover-foreground",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  secondary: "--secondary",
  secondaryForeground: "--secondary-foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  accent: "--accent",
  accentForeground: "--accent-foreground",
  destructive: "--destructive",
  border: "--border",
  input: "--input",
  ring: "--ring",
  sidebar: "--sidebar",
  sidebarForeground: "--sidebar-foreground",
  sidebarPrimary: "--sidebar-primary",
  sidebarPrimaryForeground: "--sidebar-primary-foreground",
  sidebarAccent: "--sidebar-accent",
  sidebarAccentForeground: "--sidebar-accent-foreground",
  sidebarBorder: "--sidebar-border",
  sidebarRing: "--sidebar-ring",
  radius: "--radius",
};

const ANSI_NAMES = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "bright-black", "bright-red", "bright-green", "bright-yellow",
  "bright-blue", "bright-magenta", "bright-cyan", "bright-white",
] as const;

const ALL_APPLIED_VARS: string[] = [
  ...Object.values(COLOR_VAR_MAP),
  "--terminal-background",
  "--terminal-foreground",
  "--terminal-cursor",
  "--terminal-cursor-accent",
  "--terminal-selection",
  ...ANSI_NAMES.map((n) => `--terminal-ansi-${n}`),
];

function clearThemeVars(root: HTMLElement): void {
  for (const v of ALL_APPLIED_VARS) {
    root.style.removeProperty(v);
  }
}

export function applyTheme(theme: Theme, mode: ThemeMode): void {
  const root = document.documentElement;
  clearThemeVars(root);

  const variant = theme.variants[mode];
  if (!variant) return;

  if (variant.colors) {
    for (const [key, cssVar] of Object.entries(COLOR_VAR_MAP)) {
      const value = (variant.colors as Record<string, string | undefined>)[key];
      if (value !== undefined) root.style.setProperty(cssVar, value);
    }
  }

  if (variant.terminal) {
    const t = variant.terminal;
    if (t.background) root.style.setProperty("--terminal-background", t.background);
    if (t.foreground) root.style.setProperty("--terminal-foreground", t.foreground);
    if (t.cursor) root.style.setProperty("--terminal-cursor", t.cursor);
    if (t.cursorAccent) root.style.setProperty("--terminal-cursor-accent", t.cursorAccent);
    if (t.selection) root.style.setProperty("--terminal-selection", t.selection);
    if (t.ansi) {
      t.ansi.forEach((color, i) => {
        root.style.setProperty(`--terminal-ansi-${ANSI_NAMES[i]}`, color);
      });
    }
  }
}
