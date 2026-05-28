export type SettingsTab =
  | "general"
  | "shortcuts"
  | "models"
  | "agents"
  | "themes"
  | "about";

/** Open the in-app settings tab, optionally navigating to a section. */
export function openSettingsWindow(tab?: SettingsTab): void {
  window.dispatchEvent(
    new CustomEvent("Gear:open-settings", { detail: tab ?? null }),
  );
}
