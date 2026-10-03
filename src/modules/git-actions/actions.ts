// Git workflows for the command palette.

import { compactRelativeTime } from "@/lib/toolkit/compactRelativeTime";
import { confirmPick, quickPickWithCustom } from "@/modules/quick-pick";
import type { TerminalActionDescriptor } from "@/modules/terminal";
import { toast } from "sonner";
import { BRANCH_FORMAT, branchNameFromText, isValidBranchName, parseBranches, type BranchInfo } from "./branches";
import { git, gitOrToast, requireRepo } from "./gitCli";

function trackLabel(b: BranchInfo): string {
  if (b.gone) return "upstream gone";
  const parts = [];
  if (b.ahead) parts.push(`↑${b.ahead}`);
  if (b.behind) parts.push(`↓${b.behind}`);
  return parts.join(" ");
}

export async function switchBranch(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const now = Date.now();
  const load = git(root, ["for-each-ref", "--sort=-committerdate", `--format=${BRANCH_FORMAT}`, "refs/heads"]).then((r) => {
    if (!r.ok) throw new Error(r.stderr.trim() || "git for-each-ref failed");
    return parseBranches(r.stdout).map((b) => ({
      label: b.current ? `● ${b.name}` : b.name,
      description: [trackLabel(b), compactRelativeTime(b.updated * 1000, now)].filter(Boolean).join(" · "),
      detail: b.subject,
      keywords: [b.name],
      value: b,
    }));
  });
  const choice = await quickPickWithCustom(load, {
    title: "Switch branch",
    placeholder: "Pick a branch, or type a name to create one",
    allowCustom: true,
  });
  if (!choice) return;
  if ("value" in choice) {
    if (choice.value.current) return;
    const out = await gitOrToast(root, ["switch", choice.value.name], "Switch branch");
    if (out !== null) toast.success(`Switched to ${choice.value.name}`);
    return;
  }
  const name = branchNameFromText(choice.custom);
  if (!isValidBranchName(name)) {
    toast.error(`"${choice.custom}" can't be turned into a branch name`);
    return;
  }
  if (!(await confirmPick(`Create branch ${name}?`, `Create and switch to ${name}`, "From the current HEAD; uncommitted changes come along."))) return;
  const out = await gitOrToast(root, ["switch", "-c", name], "Create branch");
  if (out !== null) toast.success(`Created and switched to ${name}`);
}

export const GIT_ACTIONS: TerminalActionDescriptor[] = [
  {
    id: "git.switchBranch",
    label: "Git: Switch branch…",
    keywords: ["checkout", "branch", "switch", "create", "new branch", "recent"],
    run: switchBranch,
  },
];
