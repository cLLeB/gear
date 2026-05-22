import { applyLanguage } from "@/i18n";
import { create } from "zustand";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  onPreferencesChange,
  type Preferences,
} from "./store";

type State = Preferences & {
  hydrated: boolean;
  /** Subscribe & hydrate. Idempotent — safe to call from multiple windows. */
  init: () => Promise<void>;
};

let initialized = false;

export const usePreferencesStore = create<State>((set) => ({
  ...DEFAULT_PREFERENCES,
  hydrated: false,
  init: async () => {
    if (initialized) return;
    initialized = true;
    const prefs = await loadPreferences();
    set({ ...prefs, hydrated: true });
    applyLanguage(prefs.language);
    void onPreferencesChange((key, value) => {
      set({ [key]: value } as Partial<State>);
      if (key === "language") applyLanguage(value as string);
    });
  },
}));
