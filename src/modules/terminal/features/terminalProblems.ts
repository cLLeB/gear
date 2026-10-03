// Runs the problem matchers over every finished command and keeps the result
// per pane, so "go to next error" works after any build, lint or test run —
// without configuring tasks first.

import { app } from "@/app/appBridge";
import { quickPick } from "@/modules/quick-pick";
import { getFeature } from "@/modules/settings/useFeature";
import { toast } from "sonner";
import type { FinishedCommand } from "../lib/useTerminalSession";
import {
  matchProblems,
  resolveProblemPath,
  summarizeProblems,
  type Problem,
} from "./problemMatchers";

export interface ResolvedProblem extends Problem {
  path: string;
}

interface Entry {
  command: string;
  problems: ResolvedProblem[];
  cursor: number;
}

const byLeaf = new Map<number, Entry>();
let latestLeaf: number | null = null;

export function handleProblemsForCommand(cmd: FinishedCommand): void {
  if (!getFeature("terminal.problemMatchers") || !cmd.output) return;
  const problems = matchProblems(cmd.output).map((p) => ({
    ...p,
    path: resolveProblemPath(p.file, cmd.cwd),
  }));
  if (problems.length === 0) {
    byLeaf.delete(cmd.leafId);
    return;
  }
  byLeaf.set(cmd.leafId, { command: cmd.command, problems, cursor: -1 });
  latestLeaf = cmd.leafId;
  if (cmd.exitCode !== 0 && getFeature("terminal.problemToast")) {
    toast.error(`${summarizeProblems(problems)} · ${truncate(cmd.command, 48)}`, {
      description: `${problems[0].file}:${problems[0].line} — ${truncate(problems[0].message, 90)}`,
      action: { label: "Open", onClick: () => openProblem(problems[0]) },
    });
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function openProblem(p: ResolvedProblem): void {
  app().openFile(p.path, p.line);
}

/** Problems for the focused terminal, else the most recent pane that had any. */
function currentEntry(): Entry | null {
  const leaf = app().activeTerminalLeaf();
  if (leaf !== null && byLeaf.has(leaf)) return byLeaf.get(leaf)!;
  return latestLeaf !== null ? (byLeaf.get(latestLeaf) ?? null) : null;
}

export async function pickProblem(): Promise<void> {
  const entry = currentEntry();
  if (!entry) {
    toast.info("No problems found in recent command output");
    return;
  }
  const choice = await quickPick(
    entry.problems.map((p, i) => ({
      label: p.message,
      description: `${p.file}:${p.line}${p.column ? `:${p.column}` : ""}`,
      detail: `${p.severity} · ${p.source}`,
      group: p.severity === "error" ? "Errors" : p.severity === "warning" ? "Warnings" : "Other",
      value: i,
    })),
    { title: `Problems from \`${truncate(entry.command, 60)}\``, placeholder: "Filter problems…" },
  );
  if (choice === undefined) return;
  entry.cursor = choice;
  openProblem(entry.problems[choice]);
}

export function stepProblem(dir: 1 | -1): void {
  const entry = currentEntry();
  if (!entry) {
    toast.info("No problems found in recent command output");
    return;
  }
  const n = entry.problems.length;
  entry.cursor = entry.cursor === -1 && dir < 0 ? n - 1 : (entry.cursor + dir + n) % n;
  const p = entry.problems[entry.cursor];
  toast.message(`Problem ${entry.cursor + 1} of ${n}`, { description: p.message });
  openProblem(p);
}
