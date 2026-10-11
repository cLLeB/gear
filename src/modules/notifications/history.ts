// A notification centre: every toast and OS notification Gear shows is kept
// (in memory, newest first) so a message that vanished before you read it can
// be found again from the palette.

import { toast } from "sonner";

export type NotificationKind = "success" | "error" | "info" | "warning" | "message" | "os";

export interface NotificationEntry {
  kind: NotificationKind;
  title: string;
  description?: string;
  at: number;
}

const MAX = 200;
let entries: NotificationEntry[] = [];

function text(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined; // React nodes / functions aren't recorded
}

export function recordNotification(kind: NotificationKind, title: unknown, description?: unknown, now = Date.now()): void {
  const t = text(title);
  if (!t) return;
  const d = text(description);
  // Collapse an identical message repeated within a few seconds.
  const last = entries[0];
  if (last && last.title === t && last.description === d && last.kind === kind && now - last.at < 5000) {
    last.at = now;
    return;
  }
  entries = [{ kind, title: t, description: d, at: now }, ...entries].slice(0, MAX);
}

export function notificationHistory(): readonly NotificationEntry[] {
  return entries;
}

export function clearNotificationHistory(): void {
  entries = [];
}

let installed = false;

/** Wrap sonner's toast methods so every call is recorded. Idempotent. */
export function installToastHistory(): void {
  if (installed) return;
  installed = true;
  const t = toast as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const kind of ["success", "error", "info", "warning", "message"] as const) {
    const original = t[kind];
    if (typeof original !== "function") continue;
    t[kind] = (message: unknown, opts?: unknown) => {
      recordNotification(kind, message, (opts as { description?: unknown } | undefined)?.description);
      return original.call(toast, message, opts);
    };
  }
}
