// Parallel agents in isolated git worktrees. Each agent instance gets its own
// branch (agent/<name>-<stamp>-<n>) checked out in its own folder, so several
// agents can edit the same project without overwriting each other. The branch
// they started from is kept in git config (branch.<b>.gearBase) so the board
// can diff and merge against it later.

import { native } from "@/modules/ai/lib/native";
import { git } from "@/modules/git-actions/gitCli";
import { parseWorktrees } from "@/modules/git-actions/extras";

export const AGENT_BRANCH_PREFIX = "agent/";

/** Short, sortable stamp for a launch (base-36 time, last 5 chars). */
export function launchStamp(now = Date.now()): string {
  return now.toString(36).slice(-5);
}

export function agentBranchName(agent: string, stamp: string, index: number): string {
  const safe = agent.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "agent";
  return `${AGENT_BRANCH_PREFIX}${safe}-${stamp}-${index}`;
}

const trimSlash = (p: string) => p.replace(/[\\/]+$/, "");

/** `<parent>/.gear-worktrees/<repo>/<branch-slug>`, next to the repository rather than inside it. */
export function agentWorktreePath(repoRoot: string, branch: string): string {
  const root = trimSlash(repoRoot.replace(/\\/g, "/"));
  const cut = root.lastIndexOf("/");
  const parent = cut > 0 ? root.slice(0, cut) : root;
  const name = root.slice(cut + 1) || "repo";
  const slug = branch.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${parent}/.gear-worktrees/${name}/${slug}`;
}

/** Root-level env files worth copying: git ignores them, but the app needs them to run. */
export function isEnvFile(name: string): boolean {
  return /^\.env(\.[\w.-]+)?$/.test(name) && !/\.(example|sample|template)$/.test(name);
}

/** An untracked `git status --porcelain` entry that is an env file Gear copied in (or the agent made). */
export function isUntrackedEnv(line: string): boolean {
  if (!line.startsWith("??")) return false;
  const path = line.slice(3).replace(/^"(.*)"$/, "$1");
  return isEnvFile(path.split("/").pop() ?? path);
}

export interface CreatedWorktree {
  branch: string;
  path: string;
}

export type CreateResult =
  | { ok: true; base: string; worktrees: CreatedWorktree[]; copiedEnv: string[] }
  | { ok: false; error: string };

/** Create `count` worktrees on fresh agent branches from the repo's current HEAD. */
export async function createAgentWorktrees(repoRoot: string, agent: string, count: number): Promise<CreateResult> {
  const head = await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!head.ok) return { ok: false, error: (head.stderr || head.stdout).trim() || "Not a git repository" };
  let base = head.stdout.trim();
  if (base === "HEAD") {
    const sha = await git(repoRoot, ["rev-parse", "HEAD"]);
    if (!sha.ok) return { ok: false, error: "The repository has no commits yet" };
    base = sha.stdout.trim();
  }

  const stamp = launchStamp();
  const worktrees: CreatedWorktree[] = [];
  for (let i = 1; i <= count; i++) {
    const branch = agentBranchName(agent, stamp, i);
    const path = agentWorktreePath(repoRoot, branch);
    const add = await git(repoRoot, ["worktree", "add", "-b", branch, path, "HEAD"], 120);
    if (!add.ok) {
      await removeAgentWorktrees(repoRoot, worktrees);
      return { ok: false, error: (add.stderr || add.stdout).trim() };
    }
    await git(repoRoot, ["config", `branch.${branch}.gearBase`, base]);
    worktrees.push({ branch, path });
  }

  const copiedEnv: string[] = [];
  try {
    const entries = await native.readDirAll(repoRoot);
    for (const e of entries) {
      if (e.kind !== "file" || !isEnvFile(e.name)) continue;
      const r = await native.readFile(`${trimSlash(repoRoot)}/${e.name}`);
      if (r.kind !== "text") continue;
      for (const wt of worktrees) await native.writeFile(`${wt.path}/${e.name}`, r.content, "user");
      copiedEnv.push(e.name);
    }
  } catch {
    // Env files are a convenience; the worktrees are usable without them.
  }
  for (const wt of worktrees) await native.workspaceAuthorize(wt.path).catch(() => {});
  return { ok: true, base, worktrees, copiedEnv };
}

async function removeAgentWorktrees(repoRoot: string, worktrees: CreatedWorktree[]): Promise<void> {
  for (const wt of worktrees) {
    await git(repoRoot, ["worktree", "remove", "--force", wt.path], 60);
    await git(repoRoot, ["branch", "-D", wt.branch]);
  }
}

export interface AgentWorktree {
  branch: string;
  path: string;
  base: string;
  /** Commits on the agent branch that the base doesn't have. */
  ahead: number;
  /** Files differing from the base, committed or not, plus untracked files. */
  files: number;
  insertions: number;
  deletions: number;
  /** Uncommitted entries in the worktree. */
  dirty: number;
}

/** `git diff --shortstat` → counts. */
export function parseShortstat(out: string): { files: number; insertions: number; deletions: number } {
  const num = (re: RegExp) => Number(re.exec(out)?.[1] ?? 0);
  return { files: num(/(\d+) files? changed/), insertions: num(/(\d+) insertions?\(\+\)/), deletions: num(/(\d+) deletions?\(-\)/) };
}

/**
 * The repository's main checkout, from any folder inside it or inside one of
 * its worktrees (where --show-toplevel would answer the worktree itself).
 */
export async function mainCheckout(dir: string): Promise<string | null> {
  const list = await git(dir, ["worktree", "list", "--porcelain"]);
  if (!list.ok) return null;
  return parseWorktrees(list.stdout.replace(/\r/g, ""))[0]?.path ?? null;
}

/** Every agent worktree of the repository, with how far each has diverged. */
export async function listAgentWorktrees(repoRoot: string): Promise<AgentWorktree[]> {
  const list = await git(repoRoot, ["worktree", "list", "--porcelain"]);
  if (!list.ok) return [];
  const mine = parseWorktrees(list.stdout.replace(/\r/g, "")).filter((w) => w.branch?.startsWith(AGENT_BRANCH_PREFIX) && !w.prunable);
  return Promise.all(
    mine.map(async (w) => {
      const branch = w.branch as string;
      const cfg = await git(repoRoot, ["config", "--get", `branch.${branch}.gearBase`]);
      const base = cfg.ok && cfg.stdout.trim() ? cfg.stdout.trim() : "HEAD";
      const [ahead, stat, status] = await Promise.all([
        git(w.path, ["rev-list", "--count", `${base}..HEAD`]),
        git(w.path, ["diff", "--shortstat", base]),
        git(w.path, ["status", "--porcelain"]),
      ]);
      // Env files copied into the worktree are setup, not the agent's work.
      const statusLines = status.ok ? status.stdout.split(/\r?\n/).filter((l) => l.length > 3 && !isUntrackedEnv(l)) : [];
      const untracked = statusLines.filter((l) => l.startsWith("??")).length;
      const s = parseShortstat(stat.ok ? stat.stdout : "");
      return {
        branch,
        path: w.path,
        base,
        ahead: Number(ahead.stdout.trim()) || 0,
        files: s.files + untracked,
        insertions: s.insertions,
        deletions: s.deletions,
        dirty: statusLines.length,
      };
    }),
  );
}

/** Diff of everything the agent changed against its base, untracked files listed at the end. */
export async function agentDiff(wt: AgentWorktree): Promise<string> {
  const [diff, untracked] = await Promise.all([
    git(wt.path, ["diff", wt.base], 60),
    git(wt.path, ["ls-files", "--others", "--exclude-standard"]),
  ]);
  const newFiles = untracked.ok ? untracked.stdout.split(/\r?\n/).filter((f) => f.trim() && !isEnvFile(f.split("/").pop() ?? f)) : [];
  const extra = newFiles.length ? `\n# New files not yet added:\n${newFiles.map((f) => `#   ${f}`).join("\n")}\n` : "";
  return (diff.ok ? diff.stdout : diff.stderr) + extra;
}

export type MergeResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Bring an agent's work into its base branch in the main checkout: commit what
 * the agent left uncommitted, then merge with a merge commit.
 */
export async function mergeAgentWorktree(repoRoot: string, wt: AgentWorktree): Promise<MergeResult> {
  if (wt.dirty > 0) {
    const add = await git(wt.path, ["add", "-A"]);
    if (!add.ok) return { ok: false, error: (add.stderr || add.stdout).trim() };
    // Never commit env files (copied secrets, or ones the agent wrote).
    const staged = await git(wt.path, ["diff", "--cached", "--name-only", "--diff-filter=A"]);
    const envs = staged.ok ? staged.stdout.split(/\r?\n/).filter((f) => f && isEnvFile(f.split("/").pop() ?? f)) : [];
    if (envs.length) await git(wt.path, ["reset", "-q", "--", ...envs]);
    const commit = await git(wt.path, ["commit", "-m", `chore(agent): work from ${wt.branch}`]);
    if (!commit.ok) return { ok: false, error: (commit.stderr || commit.stdout).trim() };
  }
  const current = await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (current.ok && current.stdout.trim() !== wt.base) {
    return { ok: false, error: `The main checkout is on ${current.stdout.trim()}, not ${wt.base}. Switch to ${wt.base} first.` };
  }
  const merge = await git(repoRoot, ["merge", "--no-ff", "--no-edit", wt.branch], 120);
  if (!merge.ok) return { ok: false, error: (merge.stdout + merge.stderr).trim() || "git merge failed" };
  return { ok: true, message: `Merged ${wt.branch} into ${wt.base}` };
}

/** Delete an agent's worktree folder and branch. */
export async function discardAgentWorktree(repoRoot: string, wt: AgentWorktree): Promise<MergeResult> {
  const rm = await git(repoRoot, ["worktree", "remove", "--force", wt.path], 120);
  if (!rm.ok) return { ok: false, error: (rm.stderr || rm.stdout).trim() };
  await git(repoRoot, ["branch", "-D", wt.branch]);
  await git(repoRoot, ["config", "--unset", `branch.${wt.branch}.gearBase`]);
  return { ok: true, message: `Removed ${wt.branch}` };
}
