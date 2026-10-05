// Terminal session restore: each pane's scrollback is saved (periodically and
// on quit) and replayed when the layout is restored, with a divider showing
// when it was saved. Commands that were still running at quit are offered for
// a re-run.

import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { getFeature } from "@/modules/settings/useFeature";
import type { Tab } from "@/modules/tabs";
import { keyForLeaf, knownLeafKey } from "../lib/paneKeys";
import { isLeaf, type PaneNode } from "../lib/panes";
import { exportLeafScrollback, leafCwd, runningCommand, seedLeafRestore, submitToLeaf, whenSessionReady } from "../lib/useTerminalSession";

interface Meta {
  cwd?: string | null;
  running?: string | null;
}

interface Loaded {
  data: string;
  meta: string | null;
  saved_at: number;
}

const MAX_LINES = 5000;

function leavesOf(tabs: Tab[]): { leafId: number; cwd?: string }[] {
  const out: { leafId: number; cwd?: string }[] = [];
  const walk = (n: PaneNode) => {
    if (isLeaf(n)) out.push({ leafId: n.id, cwd: n.cwd });
    else n.children.forEach(walk);
  };
  for (const t of tabs) if (t.kind === "terminal" && !t.private) walk(t.paneTree);
  return out;
}

/** Divider written after restored output, before the new shell's prompt. */
export function restoreDivider(savedAt: number, now = Date.now()): string {
  const mins = Math.round((now - savedAt) / 60_000);
  const when = savedAt <= 0 ? "" : mins < 1 ? " · just now" : mins < 60 ? ` · ${mins} min ago` : mins < 60 * 24 ? ` · ${Math.round(mins / 60)} h ago` : ` · ${new Date(savedAt).toLocaleDateString()}`;
  return `\x1b[0m\r\n\x1b[2m──── restored session${when} ────\x1b[0m\r\n`;
}

/** Trim a serialized buffer to its last `maxLines` lines and drop trailing blank lines. */
export function trimRestored(ansi: string, maxLines = MAX_LINES): string {
  const lines = ansi.replace(/(\r?\n|\x1b\[[0-9;]*m|\s)+$/u, "").split(/\r?\n/);
  return lines.slice(-maxLines).join("\r\n");
}

const pendingReruns: { leafId: number; command: string }[] = [];

/** Load saved scrollback for restored tabs (call before the panes mount). */
export async function restoreScrollback(tabs: Tab[]): Promise<void> {
  if (!getFeature("terminal.restoreScrollback")) return;
  const leaves = leavesOf(tabs).map((l) => ({ ...l, key: knownLeafKey(l.leafId) })).filter((l): l is { leafId: number; cwd?: string; key: string } => !!l.key);
  if (!leaves.length) return;
  const loaded = await invoke<Record<string, Loaded>>("scrollback_load", { keys: leaves.map((l) => l.key) }).catch(() => ({}) as Record<string, Loaded>);
  for (const l of leaves) {
    const entry = loaded[l.key];
    if (!entry?.data.trim()) continue;
    seedLeafRestore(l.leafId, trimRestored(entry.data) + restoreDivider(entry.saved_at));
    let meta: Meta = {};
    try {
      meta = entry.meta ? (JSON.parse(entry.meta) as Meta) : {};
    } catch {
      /* ignore */
    }
    if (meta.running) pendingReruns.push({ leafId: l.leafId, command: meta.running });
  }
  if (pendingReruns.length) setTimeout(offerReruns, 1500);
}

function offerReruns(): void {
  const list = pendingReruns.splice(0);
  if (!list.length) return;
  const names = list.map((r) => r.command).slice(0, 3).join(" · ");
  toast(`${list.length} command(s) were running when Gear closed`, {
    description: names.length > 140 ? `${names.slice(0, 137)}…` : names,
    duration: 30_000,
    action: {
      label: "Run again",
      onClick: () => {
        for (const r of list) void whenSessionReady(r.leafId, 8000).then(() => submitToLeaf(r.leafId, r.command), () => {});
      },
    },
  });
}

const lastSaved = new Map<string, number>();

/** Save the scrollback of every (non-private) pane and drop data for panes that no longer exist. */
export async function saveScrollback(tabs: Tab[], opts: { prune?: boolean } = {}): Promise<void> {
  if (!getFeature("terminal.restoreScrollback")) return;
  const maxLines = Math.min(MAX_LINES, usePreferencesStore.getState().terminalScrollback || MAX_LINES);
  const entries: { key: string; data: string; meta: string }[] = [];
  const keep: string[] = [];
  for (const { leafId } of leavesOf(tabs)) {
    const key = keyForLeaf(leafId);
    keep.push(key);
    const data = exportLeafScrollback(leafId, maxLines);
    if (!data) continue;
    const meta = JSON.stringify({ cwd: leafCwd(leafId), running: runningCommand(leafId) } satisfies Meta);
    // Skip unchanged panes (length + tail is a cheap fingerprint).
    const fp = data.length * 31 + (data.charCodeAt(data.length - 1) || 0) + meta.length;
    if (lastSaved.get(key) === fp) continue;
    lastSaved.set(key, fp);
    entries.push({ key, data, meta });
  }
  if (entries.length) await invoke("scrollback_save", { entries }).catch(() => {});
  if (opts.prune) await invoke("scrollback_prune", { keep }).catch(() => {});
}

/** Save on an interval while the app runs. Returns a stop function. */
export function startScrollbackAutosave(getTabs: () => Tab[], everyMs = 20_000): () => void {
  let pruned = false;
  const id = setInterval(() => {
    void saveScrollback(getTabs(), { prune: !pruned });
    pruned = true;
  }, everyMs);
  return () => clearInterval(id);
}

/** Final save before quitting, bounded so a slow disk can't hold the window open. */
export async function flushScrollbackBeforeQuit(tabs: Tab[]): Promise<void> {
  lastSaved.clear();
  await Promise.race([saveScrollback(tabs, { prune: true }), new Promise((r) => setTimeout(r, 1500))]);
}

