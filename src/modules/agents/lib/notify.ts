import { IS_LINUX, IS_MAC, IS_WINDOWS } from "@/lib/platform";
import { info, warn } from "@tauri-apps/plugin-log";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let granted = false;

/** Per-platform sound id. Windows accepts only the WinRT toast names
 * (Default/IM/Mail/Reminder/SMS or an Alarm/Call variant) — the plugin parses
 * this with `Sound::from_str(..).ok()`, so anything else (including the .wav
 * path its own docs suggest) is dropped and the toast arrives mute. Omitting
 * the field entirely does the same, which is why alerts were silent. */
const SOUND = IS_WINDOWS
  ? "Default"
  : IS_MAC
    ? "Ping"
    : IS_LINUX
      ? "message-new-instant"
      : undefined;

async function ensurePermission(): Promise<boolean> {
  // Cache only the positive result: a transient denial (e.g. the OS prompt
  // dismissed while unfocused) must not disable notifications for the session.
  if (granted) return true;
  let ok = await isPermissionGranted();
  if (!ok) ok = (await requestPermission()) === "granted";
  granted = ok;
  return ok;
}

export async function osNotify(title: string, body: string): Promise<void> {
  try {
    if (!(await ensurePermission())) {
      void warn(`[notify] permission denied, dropped: ${title}`);
      return;
    }
    sendNotification({ title, body, sound: SOUND });
    void info(`[notify] sent: ${title}`);
  } catch (e) {
    void warn(`[notify] failed: ${String(e)}`);
  }
}
