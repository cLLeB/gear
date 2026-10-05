import type { TerminalActionDescriptor } from "@/modules/terminal";
import { checkEnvFiles } from "./envLintAction";
import { listWorkspaceTodos } from "./todoSearch";
import { WORKSPACE_TOOL_ACTIONS } from "./workspaceTools";
import { PROJECT_ACTIONS } from "./projectActions";

/** Workspace-level palette actions. */
export const WORKSPACE_ACTIONS: TerminalActionDescriptor[] = [
  {
    id: "workspace.checkEnv",
    label: "Workspace: Check .env files",
    keywords: ["dotenv", "env", "environment", "variables", "lint", "example", "drift", "missing keys"],
    run: checkEnvFiles,
  },
  {
    id: "workspace.todos",
    label: "Workspace: List TODO / FIXME comments",
    keywords: ["todo", "fixme", "hack", "bug", "note", "tree", "tasks", "comments"],
    run: listWorkspaceTodos,
  },
  ...WORKSPACE_TOOL_ACTIONS,
  ...PROJECT_ACTIONS,
];
