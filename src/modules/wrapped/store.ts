// Gear Wrapped's state: the command log (kept in local storage, never sent
// anywhere), whether the story is open, and the monthly "your recap is ready"
// nudge.

import { dataDir, homeDir } from "@tauri-apps/api/path";
import { toast } from "sonner";
import { create } from "zustand";
import { native } from "@/modules/ai/lib/native";
import { onTerminalCommandFinished } from "@/modules/terminal";
import { dateKey, parseHistory, parseLog, prune, rangeFor, recordCommand, type Log, type RangeId } from "./model";

const LOG_KEY = "gear.wrapped.log";
const NUDGE_KEY = "gear.wrapped.nudged";
const SAVE_DELAY_MS = 2000;
const NUDGE_DELAY_MS = 20_000;
/** Enough commands last month for a recap worth a notification. */
const NUDGE_MIN_COMMANDS = 20;

function read<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export const useWrapped = create<{ log: Log; open: boolean; range: RangeId }>(() => ({
  log: read(() => parseLog(localStorage.getItem(LOG_KEY)), {}),
  open: false,
  range: "year",
}));

export function openWrapped(range: RangeId = "year"): void {
  useWrapped.setState({ open: true, range });
}

export function closeWrapped(): void {
  useWrapped.setState({ open: false });
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function save(): void {
  saveTimer = null;
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(useWrapped.getState().log));
  } catch {
    // Storage full or unavailable: this session's counts stay in memory.
  }
}

/** Starts counting finished commands (private terminals excluded). Returns a disposer. */
export function initWrapped(): () => void {
  const off = onTerminalCommandFinished((cmd) => {
    if (cmd.isPrivate || !cmd.command.trim()) return;
    const at = new Date(cmd.finishedAt);
    const today = dateKey(at);
    const log = prune(recordCommand(useWrapped.getState().log, today, at.getHours(), cmd.command, cmd.exitCode, cmd.durationMs), today);
    useWrapped.setState({ log });
    if (!saveTimer) saveTimer = setTimeout(save, SAVE_DELAY_MS);
  });
  const nudge = setTimeout(maybeNudge, NUDGE_DELAY_MS);
  const flush = () => saveTimer && (clearTimeout(saveTimer), save());
  window.addEventListener("beforeunload", flush);
  return () => {
    off();
    clearTimeout(nudge);
    window.removeEventListener("beforeunload", flush);
    flush();
  };
}

/** Once a month, when last month had enough to show, offer its recap. */
function maybeNudge(): void {
  const now = new Date();
  const month = dateKey(now).slice(0, 7);
  if (read(() => localStorage.getItem(NUDGE_KEY), month) === month) return;
  const { from, to, label } = rangeFor("lastMonth", now);
  let commands = 0;
  for (const [day, d] of Object.entries(useWrapped.getState().log)) if (day >= from && day <= to) commands += d.n;
  try {
    localStorage.setItem(NUDGE_KEY, month);
  } catch {
    // Without storage the nudge may come again next launch; harmless.
  }
  if (commands < NUDGE_MIN_COMMANDS) return;
  toast(`Your ${label} in Gear is ready ✨`, {
    description: `${commands.toLocaleString()} commands, one persona. Take a look back.`,
    duration: 12_000,
    action: { label: "Open", onClick: () => openWrapped("lastMonth") },
  });
}

let historyPromise: Promise<Record<string, number> | null> | null = null;

/**
 * Counts from the shells' own history files (PowerShell, bash, zsh, fish), so
 * a first recap is not empty. Read on demand, only on this machine, and kept
 * as labels: the lines themselves are never stored.
 */
export function loadShellHistory(): Promise<Record<string, number> | null> {
  historyPromise ??= (async () => {
    const home = (await homeDir().catch(() => "")).replace(/[\\/]+$/, "");
    const data = (await dataDir().catch(() => "")).replace(/[\\/]+$/, "");
    const candidates = [
      data && `${data}/Microsoft/Windows/PowerShell/PSReadLine/ConsoleHost_history.txt`,
      home && `${home}/.local/share/powershell/PSReadLine/ConsoleHost_history.txt`,
      home && `${home}/.bash_history`,
      home && `${home}/.zsh_history`,
      home && `${home}/.local/share/fish/fish_history`,
    ].filter(Boolean) as string[];
    const counts: Record<string, number> = {};
    let found = false;
    for (const path of candidates) {
      const r = await native.readFile(path).catch(() => null);
      if (r?.kind !== "text") continue;
      found = true;
      for (const [label, n] of Object.entries(parseHistory(r.content))) counts[label] = (counts[label] ?? 0) + n;
    }
    return found ? counts : null;
  })();
  return historyPromise;
}
