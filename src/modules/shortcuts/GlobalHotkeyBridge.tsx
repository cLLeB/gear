import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { toast } from "sonner";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useFeature } from "@/modules/settings/useFeature";

/** Registers the system-wide show / hide hotkey. Main window only. */
export function GlobalHotkeyBridge() {
  const hotkey = useFeature("window.globalHotkey");
  const hydrated = usePreferencesStore((s) => s.hydrated);

  useEffect(() => {
    if (!hydrated) return;
    invoke("window_set_global_hotkey", { shortcut: hotkey }).catch((e) => {
      toast.error("Global hotkey not registered", { description: String(e) });
    });
  }, [hotkey, hydrated]);

  return null;
}
