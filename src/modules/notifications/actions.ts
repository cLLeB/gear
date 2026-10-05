import { toast } from "sonner";
import { compactRelativeTime } from "@/lib/toolkit/compactRelativeTime";
import { quickPick } from "@/modules/quick-pick";
import { writeTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";
import { clearNotificationHistory, notificationHistory, type NotificationKind } from "./history";

const ICON: Record<NotificationKind, string> = {
  success: "✓",
  error: "✗",
  warning: "⚠",
  info: "ℹ",
  message: "•",
  os: "🔔",
};

export async function showNotificationHistory(): Promise<void> {
  const list = notificationHistory();
  const now = Date.now();
  const pick = await quickPick(
    [
      ...list.map((e) => ({
        label: `${ICON[e.kind]} ${e.title}`,
        description: compactRelativeTime(e.at, now),
        detail: e.description,
        value: e as (typeof list)[number] | null,
      })),
      ...(list.length ? [{ label: "Clear history", value: null }] : []),
    ],
    { title: "Notifications", emptyText: "No notifications yet", placeholder: "Pick one to copy its text" },
  );
  if (pick === undefined) return;
  if (pick === null) {
    clearNotificationHistory();
    return;
  }
  await writeTerminalClipboard(pick.description ? `${pick.title}\n${pick.description}` : pick.title);
  toast.success("Copied notification");
}

export const NOTIFICATION_ACTIONS = [
  {
    id: "view.notifications",
    label: "View: Notification history…",
    keywords: ["notifications", "toasts", "messages", "missed", "alerts", "history", "log"],
    run: showNotificationHistory,
  },
];
