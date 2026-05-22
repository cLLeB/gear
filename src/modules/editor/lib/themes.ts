import { atomone } from "@uiw/codemirror-theme-atomone";
import { aura } from "@uiw/codemirror-theme-aura";
import { copilot } from "@uiw/codemirror-theme-copilot";
import { githubDark, githubLight } from "@uiw/codemirror-theme-github";
import { gruvboxDark } from "@uiw/codemirror-theme-gruvbox-dark";
import { nord } from "@uiw/codemirror-theme-nord";
import { tokyoNight } from "@uiw/codemirror-theme-tokyo-night";
import { xcodeDark, xcodeLight } from "@uiw/codemirror-theme-xcode";
import type { Extension } from "@codemirror/state";
import type { EditorThemeId } from "@/modules/settings/store";

export const EDITOR_THEME_EXT: Record<EditorThemeId, Extension> = {
  atomone,
  aura,
  copilot,
  "github-dark": githubDark,
  "github-light": githubLight,
  "gruvbox-dark": gruvboxDark,
  nord,
  "tokyo-night": tokyoNight,
  "xcode-dark": xcodeDark,
  "xcode-light": xcodeLight,
};

// Themes that have no light variant — auto-swap to github-light when in light mode.
const DARK_ONLY: Set<EditorThemeId> = new Set(["atomone", "aura", "copilot", "gruvbox-dark", "nord", "tokyo-night"]);

// Paired light↔dark themes — swap the opposite half when the app theme disagrees.
const TO_LIGHT: Partial<Record<EditorThemeId, EditorThemeId>> = {
  "github-dark": "github-light",
  "xcode-dark": "xcode-light",
};
const TO_DARK: Partial<Record<EditorThemeId, EditorThemeId>> = {
  "github-light": "github-dark",
  "xcode-light": "xcode-dark",
};

export function resolveEditorTheme(
  id: EditorThemeId,
  appTheme: "light" | "dark",
): EditorThemeId {
  if (appTheme === "light") {
    if (DARK_ONLY.has(id)) return "github-light";
    return TO_LIGHT[id] ?? id;
  }
  return TO_DARK[id] ?? id;
}
