// Palette commands for secret scanning.

import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { installHook, openSecretScan } from "./secrets";

export const SECURITY_ACTIONS = [
  { id: "security.scanSecrets", label: "Security: Scan for secrets (files and git history)", keywords: ["secrets", "leak", "api key", "token", "password", "credentials", "gitleaks", "security", "scan"], run: openSecretScan },
  {
    id: "security.installHook",
    label: "Security: Install pre-commit hook that blocks secrets",
    keywords: ["secrets", "pre-commit", "hook", "git", "security"],
    run: () => {
      const root = app().workspaceRoot();
      if (!root) return void toast.error("Open a folder first");
      void installHook(root.replace(/\\/g, "/"));
    },
  },
];
