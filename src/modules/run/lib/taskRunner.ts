// Detect and run project tasks from the palette.

import { app } from "@/app/appBridge";
import { native } from "@/modules/ai/lib/native";
import { quickPick } from "@/modules/quick-pick";
import { isLeafCommandRunning } from "@/modules/terminal";
import { guardedSubmit } from "@/modules/terminal/features/guardedSubmit";
import { toast } from "sonner";
import { detectTasks, TASK_FILES, type DetectedTask } from "./taskDetect";

const SOURCE_LABEL: Record<string, string> = {
  npm: "npm scripts",
  pnpm: "pnpm scripts",
  yarn: "yarn scripts",
  bun: "bun scripts",
  make: "Makefile",
  just: "justfile",
  deno: "Deno tasks",
  composer: "Composer scripts",
  task: "Taskfile",
  pdm: "PDM scripts",
  python: "Python",
  cargo: "Cargo",
  go: "Go",
  compose: "Docker Compose",
};

let lastTask: { root: string; task: DetectedTask } | null = null;

export async function loadProjectTasks(root: string): Promise<DetectedTask[]> {
  const entries = await native.readDir(root);
  const names = entries.filter((e) => e.kind !== "dir").map((e) => e.name);
  const wanted = TASK_FILES.filter((f) => names.includes(f));
  const contents = new Map<string, string>();
  await Promise.all(
    wanted.map(async (name) => {
      try {
        const res = await native.readFile(`${root.replace(/[\\/]+$/, "")}/${name}`);
        if (res.kind === "text") contents.set(name, res.content);
      } catch {
        // unreadable: the parser just sees nothing
      }
    }),
  );
  return detectTasks(names, (n) => contents.get(n) ?? null);
}

function runTask(root: string, task: DetectedTask, where: "tab" | "here"): void {
  lastTask = { root, task };
  const leaf = app().activeTerminalLeaf();
  if (where === "here" && leaf !== null && !isLeafCommandRunning(leaf)) {
    void guardedSubmit(leaf, task.command);
    return;
  }
  app().openTerminal({ cwd: root, command: task.command });
}

export async function pickAndRunTask(): Promise<void> {
  const root = app().workspaceRoot();
  if (!root) {
    toast.error("Open a folder first");
    return;
  }
  const task = await quickPick(
    loadProjectTasks(root).then((tasks) =>
      tasks.map((t) => ({
        label: t.label,
        description: t.command,
        detail: t.detail,
        group: SOURCE_LABEL[t.source] ?? t.source,
        keywords: [t.source, t.detail ?? ""],
        value: t,
      })),
    ),
    {
      title: "Run task",
      placeholder: "Search scripts, make targets, recipes…",
      emptyText: "No tasks detected in this project",
    },
  );
  if (!task) return;
  const where = await quickPick(
    [
      { label: "Run in a new terminal tab", value: "tab" as const },
      { label: "Run in the current terminal", value: "here" as const },
    ],
    { title: task.command },
  );
  if (where) runTask(root, task, where);
}

export function rerunLastTask(): void {
  if (!lastTask) {
    toast.info("No task has been run yet");
    return;
  }
  runTask(lastTask.root, lastTask.task, "tab");
}
