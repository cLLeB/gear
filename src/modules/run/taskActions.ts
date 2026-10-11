import type { TerminalActionDescriptor } from "@/modules/terminal";
import { pickAndRunTask, rerunLastTask } from "./lib/taskRunner";

/** Workspace-level palette actions contributed by the run module. */
export const RUN_TASK_ACTIONS: TerminalActionDescriptor[] = [
  {
    id: "workspace.runTask",
    label: "Workspace: Run task…",
    keywords: ["npm", "scripts", "make", "just", "cargo", "go", "compose", "deno", "composer", "taskfile", "poetry", "build", "test", "dev"],
    run: pickAndRunTask,
  },
  {
    id: "workspace.rerunTask",
    label: "Workspace: Rerun last task",
    keywords: ["again", "repeat", "build", "test"],
    run: rerunLastTask,
  },
];
