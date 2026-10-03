// Atuin-style history search: merge Gear's workspace command timeline
// (with exit status, duration and time) and the shell's own history into one
// de-duplicated, frecency-ranked list.

export interface HistoryEntry {
  command: string;
  count: number;
  lastTs: number | null;
  lastExit: number | null;
  lastDurationMs: number | null;
  source: "workspace" | "shell";
}

/** Pull {command, exit_code, duration_ms} out of a chronicle payload, whatever its serde tagging. */
export function extractCmdPayload(payload: unknown): { command: string; exitCode: number | null; durationMs: number | null } | null {
  const visit = (v: unknown, depth: number): Record<string, unknown> | null => {
    if (!v || typeof v !== "object" || depth > 3) return null;
    const o = v as Record<string, unknown>;
    if (typeof o.command === "string") return o;
    for (const child of Object.values(o)) {
      const hit = visit(child, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  const o = visit(payload, 0);
  if (!o) return null;
  const num = (x: unknown) => (typeof x === "number" ? x : null);
  return { command: o.command as string, exitCode: num(o.exit_code ?? o.exitCode), durationMs: num(o.duration_ms ?? o.durationMs) };
}

export interface ChronicleCmd {
  ts: number;
  command: string;
  exitCode: number | null;
  durationMs: number | null;
}

export function mergeHistory(workspace: readonly ChronicleCmd[], shell: readonly string[], now: number): HistoryEntry[] {
  const map = new Map<string, HistoryEntry>();
  for (const c of [...workspace].sort((a, b) => a.ts - b.ts)) {
    const cmd = c.command.trim();
    if (!cmd) continue;
    const e = map.get(cmd);
    if (e) {
      e.count++;
      e.lastTs = c.ts;
      e.lastExit = c.exitCode;
      e.lastDurationMs = c.durationMs;
    } else {
      map.set(cmd, { command: cmd, count: 1, lastTs: c.ts, lastExit: c.exitCode, lastDurationMs: c.durationMs, source: "workspace" });
    }
  }
  // Shell history comes most-recent-first without timestamps; earlier = more recent.
  for (const raw of shell) {
    const cmd = raw.trim();
    if (!cmd) continue;
    const existing = map.get(cmd);
    if (existing) existing.count++;
    else map.set(cmd, { command: cmd, count: 1, lastTs: null, lastExit: null, lastDurationMs: null, source: "shell" });
  }
  const score = (e: HistoryEntry) => {
    const age = e.lastTs === null ? 30 * 86_400_000 : now - e.lastTs;
    const recency = age < 3_600_000 ? 4 : age < 86_400_000 ? 2 : age < 7 * 86_400_000 ? 1 : 0.5;
    return e.count * recency + (e.source === "workspace" ? 0.5 : 0);
  };
  const order = new Map(shell.map((c, i) => [c.trim(), i]));
  return [...map.values()].sort(
    (a, b) => score(b) - score(a) || (b.lastTs ?? 0) - (a.lastTs ?? 0) || (order.get(a.command) ?? 0) - (order.get(b.command) ?? 0),
  );
}

// ------------------------------------------------------------- action

import { app } from "@/app/appBridge";
import { getLaunchDir } from "@/lib/launchDir";
import { compactRelativeTime } from "@/lib/toolkit/compactRelativeTime";
import { quickPick } from "@/modules/quick-pick";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { isLeafCommandRunning, writeToSession } from "../lib/useTerminalSession";
import { guardedSubmit } from "./guardedSubmit";
import { formatDurationShort } from "./lastCommandStore";

async function loadHistory(): Promise<HistoryEntry[]> {
  const now = Date.now();
  const root = getLaunchDir();
  const [events, shell] = await Promise.all([
    root
      ? invoke<Array<{ ts: number; kind: string; payload: unknown }>>("chronicle_range", {
          workspaceRoot: root,
          fromTs: now - 90 * 86_400_000,
          toTs: now,
          limit: 3000,
        }).catch(() => [])
      : Promise.resolve([]),
    invoke<string[]>("history_list", { query: "", limit: 2000 }).catch(() => []),
  ]);
  const cmds: ChronicleCmd[] = [];
  for (const e of events) {
    if (e.kind !== "cmd") continue;
    const p = extractCmdPayload(e.payload);
    if (p) cmds.push({ ts: e.ts, ...p });
  }
  return mergeHistory(cmds, shell, now);
}

export async function searchHistory(): Promise<void> {
  const leaf = app().activeTerminalLeaf();
  const now = Date.now();
  const entry = await quickPick(
    loadHistory().then((list) =>
      list.slice(0, 3000).map((e) => ({
        label: e.command,
        description: [
          e.lastExit === null ? null : e.lastExit === 0 ? "✓" : `✗ ${e.lastExit}`,
          e.lastDurationMs !== null ? formatDurationShort(e.lastDurationMs) : null,
          e.lastTs !== null ? compactRelativeTime(e.lastTs, now) : null,
          e.count > 1 ? `×${e.count}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        group: e.source === "workspace" ? "This workspace" : "Shell history",
        value: e,
      })),
    ),
    { title: "Search command history", placeholder: "Fuzzy search past commands…", emptyText: "No history yet" },
  );
  if (!entry) return;
  if (leaf === null || isLeafCommandRunning(leaf)) {
    await navigator.clipboard.writeText(entry.command).catch(() => {});
    toast.success("Copied", { description: entry.command });
    return;
  }
  const action = await quickPick(
    [
      { label: "Insert at prompt", value: "insert" as const },
      { label: "Run now", value: "run" as const },
    ],
    { title: entry.command },
  );
  if (action === "insert") writeToSession(leaf, entry.command);
  else if (action === "run") void guardedSubmit(leaf, entry.command);
}
