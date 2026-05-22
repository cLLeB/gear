import type { Theme } from "./types";
import { validateTheme } from "./validateTheme";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

export const THEME_FILE_EXT = ".gear";
const THEME_EDIT_EVENT = "Gear://theme-edit";

export function starterTheme(): Theme {
  return {
    id: `custom-${Date.now()}`,
    name: "My Theme",
    author: "",
    description: "",
    variants: {
      light: { colors: {} },
      dark: { colors: {} },
    },
  };
}

export function parseThemeFile(content: string): Theme {
  const raw = JSON.parse(content) as unknown;
  return validateTheme(raw);
}

export function downloadThemeFile(theme: Theme): void {
  const content = JSON.stringify(theme, null, 2);
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${theme.id}${THEME_FILE_EXT}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function emitThemeEdit(theme: Theme): Promise<void> {
  await emit(THEME_EDIT_EVENT, theme);
}

export async function onThemeEdit(
  cb: (theme: Theme) => void,
): Promise<UnlistenFn> {
  return listen<Theme>(THEME_EDIT_EVENT, (e) => cb(e.payload));
}
