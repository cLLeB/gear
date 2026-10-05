// Palette actions for themes: a WCAG contrast audit of the active theme.

import { toast } from "sonner";
import { loadPreferences } from "@/modules/settings/store";
import { quickPick } from "@/modules/quick-pick";
import type { TerminalActionDescriptor } from "@/modules/terminal";
import { auditTheme } from "./contrast";
import { loadCustomThemes } from "./customThemes";
import { getBuiltinTheme, getDefaultTheme } from "./themes";

export async function auditActiveThemeContrast(): Promise<void> {
  const prefs = await loadPreferences();
  const theme =
    getBuiltinTheme(prefs.themeId) ??
    (await loadCustomThemes()).find((t) => t.id === prefs.themeId) ??
    getDefaultTheme();
  const mode = document.documentElement.classList.contains("light") ? "light" : "dark";
  const report = auditTheme(theme).sort((a, b) => (a.mode === mode ? -1 : b.mode === mode ? 1 : 0));
  const issues = report.flatMap((r) => r.issues.map((i) => ({ ...i, mode: r.mode })));
  if (!issues.length) {
    toast.success(`${theme.name} passes WCAG AA contrast checks`);
    return;
  }
  await quickPick(
    issues.map((i) => ({
      label: `${i.pair} — ${i.ratio.toFixed(2)}:1 (needs ${i.minimum}:1)`,
      detail: `${i.mode} · ${i.fg} on ${i.bg}`,
      value: i.pair,
    })),
    { title: `${theme.name}: ${issues.length} low-contrast pair${issues.length === 1 ? "" : "s"}` },
  );
}

export const THEME_ACTIONS: TerminalActionDescriptor[] = [
  {
    id: "theme.auditContrast",
    label: "Theme: Check contrast (WCAG)",
    keywords: ["accessibility", "a11y", "contrast", "readability", "wcag", "colors", "audit"],
    run: auditActiveThemeContrast,
  },
];
