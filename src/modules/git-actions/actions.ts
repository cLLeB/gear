// Git workflows for the command palette.

import { compactRelativeTime } from "@/lib/toolkit/compactRelativeTime";
import { confirmPick, quickPickWithCustom } from "@/modules/quick-pick";
import type { TerminalActionDescriptor } from "@/modules/terminal";
import { toast } from "sonner";
import {
  baseFromRemoteHead,
  BRANCH_FORMAT,
  branchNameFromText,
  cleanupCandidates,
  isValidBranchName,
  parseBranches,
  type BranchInfo,
  type CleanupCandidate,
} from "./branches";
import { quickPick } from "@/modules/quick-pick";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { app } from "@/app/appBridge";
import { FILE_LOG_FORMAT, parseFileLog } from "./fileLog";
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

async function baseBranch(root: string, branches: BranchInfo[]): Promise<string> {
  const head = await git(root, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  const fromRemote = head.ok ? baseFromRemoteHead(head.stdout) : null;
  if (fromRemote) return fromRemote;
  return ["main", "master", "trunk", "develop"].find((n) => branches.some((b) => b.name === n)) ?? "main";
}

const REASON: Record<CleanupCandidate["reason"], string> = {
  merged: "merged",
  gone: "upstream deleted, NOT merged",
  "merged+gone": "merged, upstream deleted",
};

export async function cleanupBranches(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  // Refresh remote-tracking info so "gone" is accurate.
  await git(root, ["fetch", "--prune", "--quiet"], 60);
  const list = await gitOrToast(root, ["for-each-ref", `--format=${BRANCH_FORMAT}`, "refs/heads"], "List branches");
  if (list === null) return;
  const branches = parseBranches(list);
  const base = await baseBranch(root, branches);
  const merged = await git(root, ["branch", "--merged", base, "--format=%(refname:short)"]);
  const candidates = cleanupCandidates(branches, new Set(merged.stdout.split("\n").map((l) => l.trim()).filter(Boolean)), base);
  if (candidates.length === 0) {
    toast.success("No stale branches", { description: `Every other branch has unmerged work relative to ${base}.` });
    return;
  }
  const safe = candidates.filter((c) => c.reason !== "gone");
  const pick = await quickPick<"all-safe" | CleanupCandidate>(
    [
      ...(safe.length > 0
        ? [{ label: `Delete all ${safe.length} merged branch${safe.length === 1 ? "" : "es"}`, detail: safe.map((c) => c.branch.name).join(", "), group: "Bulk", value: "all-safe" as const }]
        : []),
      ...candidates.map((c) => ({ label: c.branch.name, description: REASON[c.reason], detail: c.branch.subject, group: "Delete one", value: c })),
    ],
    { title: `Stale branches (base: ${base})` },
  );
  if (!pick) return;
  const targets = pick === "all-safe" ? safe : [pick];
  const force = targets.some((c) => c.reason === "gone");
  if (force && !(await confirmPick(`${targets[0].branch.name} has commits that were never merged`, "Delete it anyway (git branch -D)"))) return;
  const out = await gitOrToast(root, ["branch", force ? "-D" : "-d", ...targets.map((c) => c.branch.name)], "Delete branches");
  if (out !== null) toast.success(`Deleted ${targets.length} branch${targets.length === 1 ? "" : "es"}`, { description: targets.map((c) => c.branch.name).join(", ") });
}

export async function fileHistory(): Promise<void> {
  const path = getActiveEditor()?.path;
  if (!path) {
    toast.error("Open a file in the editor first");
    return;
  }
  const root = await requireRepo();
  if (!root) return;
  const base = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const rel = path.replace(/\\/g, "/").slice(base.length + 1);
  const now = Date.now();
  const load = git(root, ["log", "--follow", "--name-status", `--format=${FILE_LOG_FORMAT}`, "-n", "300", "--", rel]).then((r) => {
    if (!r.ok) throw new Error(r.stderr.trim() || "git log failed");
    return parseFileLog(r.stdout).map((c) => ({
      label: c.subject,
      description: `${c.shortSha} · ${c.author} · ${compactRelativeTime(c.time * 1000, now)}`,
      detail: c.originalPath ? `renamed from ${c.originalPath}` : c.status === "A" ? "added" : undefined,
      keywords: [c.sha, c.author],
      value: c,
    }));
  });
  const commit = await quickPick(load, {
    title: `History of ${rel}`,
    placeholder: "Search commits by message, author or sha…",
    emptyText: "No commits touch this file (is it untracked?)",
  });
  if (!commit) return;
  app().openCommitFileDiff({
    repoRoot: root,
    sha: commit.sha,
    shortSha: commit.shortSha,
    subject: commit.subject,
    path: commit.path,
    originalPath: commit.originalPath,
  });
}

export async function undoLastCommit(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const head = await git(root, ["log", "-1", "--format=%h%x1f%s%x1f%P"]);
  if (!head.ok || !head.stdout.trim()) {
    toast.error("There is no commit to undo");
    return;
  }
  const [short, subject, parents] = head.stdout.trim().split("\x1f");
  if (!parents) {
    toast.error("This is the repository's first commit; there is nothing to reset to");
    return;
  }
  if (parents.split(" ").length > 1) {
    toast.error("HEAD is a merge commit", { description: "Undo merges deliberately from a terminal (git reset --merge)." });
    return;
  }
  // Already on a remote branch? Rewriting it means a force-push for everyone.
  const remote = await git(root, ["branch", "-r", "--contains", "HEAD"]);
  const pushed = remote.ok && remote.stdout.trim() !== "";
  const ok = await confirmPick(
    pushed ? `⚠ ${short} is already pushed (${remote.stdout.trim().split("\n")[0].trim()})` : `Undo ${short}?`,
    pushed ? "Undo anyway (you will need to force-push)" : `Undo "${subject}"`,
    "Changes from the commit stay staged in the working tree (git reset --soft HEAD~1).",
  );
  if (!ok) return;
  const out = await gitOrToast(root, ["reset", "--soft", "HEAD~1"], "Undo commit");
  if (out !== null) toast.success(`Undid ${short}`, { description: `"${subject}" — its changes are staged.` });
}

export async function fixupCommit(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const staged = await git(root, ["diff", "--cached", "--quiet"]);
  if (staged.ok) {
    toast.info("Stage the changes you want to fold into an earlier commit first");
    return;
  }
  const upstream = await git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  const range = upstream.ok ? [`${upstream.stdout.trim()}..HEAD`] : ["-n", "30"];
  const log = await gitOrToast(root, ["log", "--no-merges", "--format=%H%x1f%h%x1f%s%x1f%at", ...range], "List commits");
  if (log === null) return;
  const now = Date.now();
  const commits = log
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [sha, short, subject, at] = l.split("\x1f");
      return { sha, short, subject, at: Number(at) };
    })
    .filter((c) => !/^(fixup|squash)! /.test(c.subject));
  if (commits.length === 0) {
    toast.info(upstream.ok ? "No unpushed commits to fix up" : "No commits to fix up");
    return;
  }
  const target = await quickPick(
    commits.map((c) => ({ label: c.subject, description: `${c.short} · ${compactRelativeTime(c.at * 1000, now)}`, value: c })),
    { title: "Fold staged changes into…", placeholder: upstream.ok ? "Unpushed commits" : "Recent commits" },
  );
  if (!target) return;
  if ((await gitOrToast(root, ["commit", "--no-verify", `--fixup=${target.sha}`], "Fixup commit")) === null) return;
  const now2 = await quickPick(
    [
      { label: "Squash it in now", detail: `git rebase --autosquash ${target.short}~1`, value: true },
      { label: "Leave the fixup! commit for later", value: false },
    ],
    { title: `Created fixup! ${target.subject}` },
  );
  if (!now2) return;
  const rebase = await git(root, ["-c", "sequence.editor=:", "rebase", "-i", "--autosquash", "--autostash", `${target.sha}~1`], 120);
  if (!rebase.ok) {
    await git(root, ["rebase", "--abort"]);
    toast.error("Autosquash hit a conflict and was aborted", {
      description: "The fixup! commit is still there; squash it from a terminal when ready.",
    });
    return;
  }
  toast.success(`Folded changes into ${target.short}`, { description: target.subject });
}

export const GIT_ACTIONS: TerminalActionDescriptor[] = [
  {
    id: "git.fixup",
    label: "Git: Fold staged changes into an earlier commit…",
    keywords: ["fixup", "autosquash", "amend", "absorb", "rebase", "squash"],
    run: fixupCommit,
  },
  {
    id: "git.undoLastCommit",
    label: "Git: Undo last commit (keep changes)",
    keywords: ["reset", "soft", "uncommit", "revert", "undo"],
    run: undoLastCommit,
  },
  {
    id: "git.fileHistory",
    label: "Git: File history…",
    keywords: ["log", "history", "timeline", "commits", "blame", "follow", "file"],
    run: fileHistory,
  },
  {
    id: "git.cleanupBranches",
    label: "Git: Clean up merged / gone branches…",
    keywords: ["prune", "delete", "branches", "stale", "merged", "gone", "tidy"],
    run: cleanupBranches,
  },
  {
    id: "git.switchBranch",
    label: "Git: Switch branch…",
    keywords: ["checkout", "branch", "switch", "create", "new branch", "recent"],
    run: switchBranch,
  },
];
