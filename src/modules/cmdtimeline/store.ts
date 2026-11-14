// Records every command that finishes in any terminal (shell integration
// required) for the command timeline. Kept in memory for this session only;
// private terminals are skipped.

import { create } from "zustand";
import { onTerminalCommandFinished } from "@/modules/terminal/lib/useTerminalSession";
import type { TimelineEntry } from "./model";

const MAX_ENTRIES = 3000;

export const useTimeline = create<{ entries: TimelineEntry[] }>(() => ({ entries: [] }));

let nextId = 1;
let installed = false;

export function installCommandTimeline(): void {
  if (installed) return;
  installed = true;
  onTerminalCommandFinished((cmd) => {
    if (cmd.isPrivate || !cmd.command.trim()) return;
    const finishedAt = cmd.finishedAt;
    const entry: TimelineEntry = {
      id: nextId++,
      leafId: cmd.leafId,
      command: cmd.command.trim(),
      exitCode: cmd.exitCode,
      startedAt: finishedAt - Math.max(0, cmd.durationMs ?? 0),
      finishedAt,
      cwd: cmd.cwd,
    };
    useTimeline.setState((s) => ({ entries: [...s.entries.slice(-(MAX_ENTRIES - 1)), entry] }));
  });
}

export function clearTimeline(): void {
  useTimeline.setState({ entries: [] });
}
