import { IS_LINUX, IS_MAC, IS_WINDOWS } from "@/lib/platform";
import { info, warn } from "@tauri-apps/plugin-log";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export type OsNotificationResult = "requested" | "denied" | "failed";

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

/** Requests a native notification. "requested" only means the platform accepted
 *  the call — it is not proof a toast was shown. */
export async function osNotify(
  title: string,
  body: string,
): Promise<OsNotificationResult> {
  try {
    if (!(await ensurePermission())) {
      void warn(`[notify] permission denied, dropped: ${title}`);
      return "denied";
    }
    sendNotification({ title, body, sound: SOUND });
    void info(`[notify] sent: ${title}`);
    return "requested";
  } catch (e) {
    void warn(`[notify] failed: ${String(e)}`);
    return "failed";
  }
}

/** Fires a real native notification so the user can confirm delivery from
 *  settings. Routing normally suppresses alerts while Gear is focused and the
 *  agent is visible, which makes delivery impossible to verify by hand — the
 *  caller delays this so the user can switch apps first. */
export async function testAgentOsNotification(): Promise<OsNotificationResult> {
  return osNotify(
    "Gear notifications are working",
    "You will be notified when an agent needs your attention.",
  );
}
