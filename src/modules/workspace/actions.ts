import type { TerminalActionDescriptor } from "@/modules/terminal";
import { checkEnvFiles } from "./envLintAction";

/** Workspace-level palette actions. */
export const WORKSPACE_ACTIONS: TerminalActionDescriptor[] = [
  {
    id: "workspace.checkEnv",
    label: "Workspace: Check .env files",
    keywords: ["dotenv", "env", "environment", "variables", "lint", "example", "drift", "missing keys"],
    run: checkEnvFiles,
  },
];
