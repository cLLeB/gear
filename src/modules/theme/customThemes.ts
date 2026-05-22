import type { Theme } from "./types";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { LazyStore } from "@tauri-apps/plugin-store";

const STORE_PATH = "Gear-custom-themes.json";
const THEMES_KEY = "themes";
const CHANGED_EVENT = "Gear://custom-themes-changed";

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 500 });

export async function loadCustomThemes(): Promise<Theme[]> {
  const raw = await store.get<Theme[]>(THEMES_KEY);
  return raw ?? [];
}

export async function saveCustomTheme(theme: Theme): Promise<void> {
  const existing = await loadCustomThemes();
  const idx = existing.findIndex((t) => t.id === theme.id);
  const updated =
    idx >= 0
      ? existing.map((t) => (t.id === theme.id ? theme : t))
      : [...existing, theme];
  await store.set(THEMES_KEY, updated);
  await store.save();
  await emit(CHANGED_EVENT, updated);
}

export async function deleteCustomTheme(id: string): Promise<void> {
  const existing = await loadCustomThemes();
  const updated = existing.filter((t) => t.id !== id);
  await store.set(THEMES_KEY, updated);
  await store.save();
  await emit(CHANGED_EVENT, updated);
}

export async function onCustomThemesChange(
  cb: (themes: Theme[]) => void,
): Promise<UnlistenFn> {
  return listen<Theme[]>(CHANGED_EVENT, (e) => cb(e.payload));
}
