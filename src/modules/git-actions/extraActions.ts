// More git workflows for the palette: stashes, worktrees, tags, cherry-pick,
// bisect, rewording the last commit, restoring a file from another ref and
// adding paths to .gitignore.

import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { native } from "@/modules/ai/lib/native";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { confirmPick, inputBox, quickPick, quickPickWithCustom } from "@/modules/quick-pick";
import type { TerminalActionDescriptor } from "@/modules/terminal";
import { git, gitOrToast, requireRepo } from "./gitCli";
import { BRANCH_FORMAT, branchNameFromText, isValidBranchName, parseBranches } from "./branches";
import {
  appendGitignore,
  gitignorePatternFor,
  LOG_FORMAT,
  nextVersionTags,
  parseBisectOutput,
  parseLog,
  parseStashList,
  parseTags,
  parseWorktrees,
  STASH_FORMAT,
  TAG_FORMAT,
  worktreePathFor,
} from "./extras";

function relativeToRoot(root: string, path: string): string {
  const base = root.replace(/\\/g, "/").replace(/\/+$/, "");
  return path.replace(/\\/g, "/").slice(base.length + 1);
}

// ── stashes ───────────────────────────────────────────────────────────────

export async function stashChanges(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const status = await git(root, ["status", "--porcelain"]);
  if (status.ok && !status.stdout.trim()) {
    toast.info("Nothing to stash");
    return;
  }
  const message = await inputBox({ title: "Stash message (optional)", placeholder: "e.g. half-done login refactor" });
  if (message === undefined) return;
  const mode = await quickPick(
    [
      { label: "Tracked changes", value: [] as string[] },
      { label: "Tracked + untracked files", value: ["--include-untracked"] },
      { label: "Only unstaged changes (keep the index)", value: ["--keep-index"] },
      { label: "Only staged changes", value: ["--staged"] },
    ],
    { title: "What to stash" },
  );
  if (!mode) return;
  const args = ["stash", "push", ...mode, ...(message.trim() ? ["-m", message.trim()] : [])];
  if ((await gitOrToast(root, args, "Stash")) !== null) toast.success("Changes stashed");
}

export async function manageStashes(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const list = await git(root, ["stash", "list", `--format=${STASH_FORMAT}`]);
  const stashes = list.ok ? parseStashList(list.stdout) : [];
  if (!stashes.length) {
    toast.info("No stashes", { description: "Use “Git: Stash changes…” to create one." });
    return;
  }
  const stash = await quickPick(
    stashes.map((s) => ({ label: s.message || "(no message)", description: [s.ref, s.branch, s.when].filter(Boolean).join(" · "), value: s })),
    { title: "Stashes" },
  );
  if (!stash) return;
  const action = await quickPick(
    [
      { label: "Apply", description: "keep the stash", value: "apply" as const },
      { label: "Pop", description: "apply and drop", value: "pop" as const },
      { label: "Show changed files…", value: "show" as const },
      { label: "Create branch from stash…", value: "branch" as const },
      { label: "Drop", description: "delete permanently", value: "drop" as const },
    ],
    { title: `${stash.ref}: ${stash.message}` },
  );
  if (!action) return;
  if (action === "show") {
    const [files, sha] = await Promise.all([
      git(root, ["stash", "show", "--name-only", "--include-untracked", stash.ref]),
      git(root, ["rev-parse", stash.ref]),
    ]);
    const paths = files.stdout.split("\n").filter(Boolean);
    const path = await quickPick(paths.map((p) => ({ label: p, value: p })), { title: `Files in ${stash.ref}`, emptyText: "No file changes" });
    if (!path || !sha.ok) return;
    const full = sha.stdout.trim();
    app().openCommitFileDiff({ repoRoot: root, sha: full, shortSha: stash.ref, subject: stash.message, path, originalPath: null });
    return;
  }
  if (action === "drop" && !(await confirmPick(`Drop ${stash.ref}?`, "Drop stash", stash.message))) return;
  if (action === "branch") {
    const name = await inputBox({ title: "New branch name", placeholder: "feat/…" });
    if (!name) return;
    const branch = branchNameFromText(name);
    if (!isValidBranchName(branch)) {
      toast.error(`"${name}" isn't a valid branch name`);
      return;
    }
    if ((await gitOrToast(root, ["stash", "branch", branch, stash.ref], "Stash branch")) !== null) toast.success(`Created ${branch} from ${stash.ref}`);
    return;
  }
  const out = await gitOrToast(root, ["stash", action, stash.ref], `Stash ${action}`);
  if (out !== null) toast.success(action === "drop" ? `Dropped ${stash.ref}` : `Stash ${action === "pop" ? "popped" : "applied"}`);
}

// ── worktrees ─────────────────────────────────────────────────────────────

async function createWorktree(root: string): Promise<void> {
  const branches = await git(root, ["for-each-ref", "--sort=-committerdate", `--format=${BRANCH_FORMAT}`, "refs/heads"]);
  const list = branches.ok ? parseBranches(branches.stdout).filter((b) => !b.current) : [];
  const choice = await quickPickWithCustom(
    list.map((b) => ({ label: b.name, description: b.subject, value: b.name })),
    { title: "New worktree", placeholder: "Pick a branch to check out, or type a new branch name", allowCustom: true },
  );
  if (!choice) return;
  const isNew = !("value" in choice);
  const branch = isNew ? branchNameFromText(choice.custom) : choice.value;
  if (!isValidBranchName(branch)) {
    toast.error(`"${branch}" isn't a valid branch name`);
    return;
  }
  const path = worktreePathFor(root, branch);
  const args = isNew ? ["worktree", "add", "-b", branch, path] : ["worktree", "add", path, branch];
  if ((await gitOrToast(root, args, "Add worktree")) === null) return;
  toast.success(`Worktree ready: ${path}`);
  app().openTerminal({ cwd: path });
}

export async function manageWorktrees(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const r = await git(root, ["worktree", "list", "--porcelain"]);
  const wts = r.ok ? parseWorktrees(r.stdout) : [];
  const pick = await quickPick(
    [
      { label: "＋ New worktree…", description: "check out a branch in a sibling folder", value: null },
      ...wts.map((w) => ({
        label: w.branch ?? `(detached ${w.head.slice(0, 7)})`,
        description: [w.main ? "main" : "", w.locked ? "locked" : "", w.prunable ? "missing" : ""].filter(Boolean).join(" · "),
        detail: w.path,
        value: w,
      })),
    ],
    { title: "Worktrees", placeholder: "Work on several branches at once — e.g. one agent per worktree" },
  );
  if (pick === undefined) return;
  if (pick === null) return createWorktree(root);
  const action = await quickPick(
    [
      { label: "Open terminal here", value: "open" as const },
      ...(pick.main ? [] : [{ label: "Remove worktree", value: "remove" as const }]),
      { label: "Prune stale worktree records", value: "prune" as const },
    ],
    { title: pick.path },
  );
  if (action === "open") app().openTerminal({ cwd: pick.path });
  else if (action === "prune") {
    if ((await gitOrToast(root, ["worktree", "prune", "-v"], "Prune")) !== null) toast.success("Pruned stale worktrees");
  } else if (action === "remove") {
    if (!(await confirmPick(`Remove worktree ${pick.path}?`, "Remove", "The folder is deleted; the branch is kept."))) return;
    let out = await git(root, ["worktree", "remove", pick.path]);
    if (!out.ok && /modified or untracked|contains modified/i.test(out.stderr)) {
      if (!(await confirmPick("The worktree has uncommitted changes", "Remove anyway (discard them)"))) return;
      out = await git(root, ["worktree", "remove", "--force", pick.path]);
    }
    if (out.ok) toast.success("Worktree removed");
    else toast.error("Remove worktree failed", { description: out.stderr.trim().slice(0, 300) });
  }
}

// ── tags ──────────────────────────────────────────────────────────────────

export async function createTag(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const existing = await git(root, ["tag", "--list"]);
  const suggestions = nextVersionTags(existing.stdout.split("\n").filter(Boolean));
  const head = await git(root, ["log", "-1", "--format=%h %s"]);
  const choice = await quickPickWithCustom(
    suggestions.map((t) => ({ label: t, value: t })),
    { title: `Tag ${head.stdout.trim()}`, placeholder: "Pick the next version or type a tag name", allowCustom: true },
  );
  if (!choice) return;
  const name = ("value" in choice ? choice.value : choice.custom).trim();
  if (!name || /[\s~^:?*[\\]/.test(name)) {
    toast.error(`"${name}" isn't a valid tag name`);
    return;
  }
  const message = await inputBox({ title: `Message for ${name} (empty for a lightweight tag)`, value: `Release ${name}` });
  if (message === undefined) return;
  const args = message.trim() ? ["tag", "-a", name, "-m", message.trim()] : ["tag", name];
  if ((await gitOrToast(root, args, "Create tag")) === null) return;
  if (await confirmPick(`Created ${name}. Push it to origin?`, "Push tag")) {
    if ((await gitOrToast(root, ["push", "origin", name], "Push tag")) !== null) toast.success(`Pushed ${name}`);
  } else toast.success(`Created ${name}`);
}

export async function deleteTag(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const r = await git(root, ["for-each-ref", "--sort=-creatordate", `--format=${TAG_FORMAT}`, "refs/tags"]);
  const tag = await quickPick(
    parseTags(r.stdout).map((t) => ({ label: t.name, description: `${t.sha} · ${t.when}`, detail: t.subject, value: t })),
    { title: "Delete tag", emptyText: "No tags" },
  );
  if (!tag) return;
  const where = await quickPick(
    [
      { label: "Locally", value: "local" as const },
      { label: "Locally and on origin", value: "both" as const },
    ],
    { title: `Delete ${tag.name}` },
  );
  if (!where) return;
  if ((await gitOrToast(root, ["tag", "-d", tag.name], "Delete tag")) === null) return;
  if (where === "both" && (await gitOrToast(root, ["push", "origin", "--delete", tag.name], "Delete remote tag")) === null) return;
  toast.success(`Deleted ${tag.name}`);
}

// ── cherry-pick ───────────────────────────────────────────────────────────

export async function cherryPick(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const refs = await git(root, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads", "refs/remotes"]);
  const current = (await git(root, ["branch", "--show-current"])).stdout.trim();
  const branch = await quickPick(
    refs.stdout
      .split("\n")
      .filter((b) => b && b !== current && !b.endsWith("/HEAD"))
      .map((b) => ({ label: b, value: b })),
    { title: "Cherry-pick from branch" },
  );
  if (!branch) return;
  const log = await git(root, ["log", "--no-merges", "--cherry-pick", "--right-only", `--format=${LOG_FORMAT}`, "-n", "200", `HEAD...${branch}`]);
  const commit = await quickPick(
    parseLog(log.stdout).map((c) => ({ label: c.subject, description: `${c.short} · ${c.author} · ${c.when}`, keywords: [c.sha], value: c })),
    { title: `Commits on ${branch} not on ${current || "HEAD"}`, emptyText: "Nothing to pick: every commit is already here" },
  );
  if (!commit) return;
  const r = await git(root, ["cherry-pick", "-x", commit.sha]);
  if (r.ok) {
    toast.success(`Picked ${commit.short}`, { description: commit.subject });
    return;
  }
  if (/conflict/i.test(r.stdout + r.stderr)) {
    const next = await quickPick(
      [
        { label: "Resolve the conflicts myself", description: "then run git cherry-pick --continue", value: "keep" as const },
        { label: "Abort the cherry-pick", value: "abort" as const },
      ],
      { title: `Conflicts picking ${commit.short}` },
    );
    if (next === "abort") await gitOrToast(root, ["cherry-pick", "--abort"], "Abort");
    return;
  }
  toast.error("Cherry-pick failed", { description: (r.stderr || r.stdout).trim().slice(0, 300) });
}

// ── bisect ────────────────────────────────────────────────────────────────

function reportBisect(out: string): void {
  const s = parseBisectOutput(out);
  if (s.done) {
    const subject = /^\s{4}(.+)$/m.exec(out)?.[1] ?? "";
    toast.success(`First bad commit: ${s.done.slice(0, 10)}`, { description: subject || undefined, duration: 15000 });
  } else if (s.current) {
    toast.info(`Now testing ${s.current.slice(0, 10)}`, { description: `${s.remaining} revisions left (≈${s.steps} steps). Test it, then mark it good or bad.` });
  } else toast.info(out.trim().split("\n")[0] || "Bisect updated");
}

export async function bisect(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const active = (await git(root, ["bisect", "log"])).ok;
  if (!active) {
    const log = await git(root, ["log", `--format=${LOG_FORMAT}`, "-n", "300"]);
    const commits = parseLog(log.stdout);
    const good = await quickPick(
      commits.slice(1).map((c) => ({ label: c.subject, description: `${c.short} · ${c.when}`, keywords: [c.sha], value: c })),
      { title: "Bisect: pick a known GOOD commit (HEAD is assumed bad)", placeholder: "Search by message or sha…" },
    );
    if (!good) return;
    const r = await git(root, ["bisect", "start", "HEAD", good.sha]);
    if (!r.ok) {
      toast.error("Bisect start failed", { description: r.stderr.trim().slice(0, 300) });
      return;
    }
    reportBisect(r.stdout);
    return;
  }
  const action = await quickPick(
    [
      { label: "Good — this commit works", value: "good" },
      { label: "Bad — this commit is broken", value: "bad" },
      { label: "Skip — can't test this one", value: "skip" },
      { label: "Run a test command automatically…", description: "git bisect run", value: "run" },
      { label: "Show bisect log", value: "log" },
      { label: "Finish / reset", description: "back to where you started", value: "reset" },
    ],
    { title: "Bisect in progress" },
  );
  if (!action) return;
  if (action === "run") {
    const cmd = await inputBox({ title: "Test command (exit 0 = good, 1–127 = bad, 125 = skip)", placeholder: "npm test -- --run src/thing.test.ts" });
    if (!cmd) return;
    app().openTerminal({ cwd: root, command: `git bisect run ${cmd}` });
    return;
  }
  if (action === "log") {
    const r = await git(root, ["bisect", "log"]);
    await quickPick(
      r.stdout.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => ({ label: l, value: l })),
      { title: "Bisect log" },
    );
    return;
  }
  const r = await git(root, ["bisect", action]);
  if (!r.ok) {
    toast.error(`Bisect ${action} failed`, { description: r.stderr.trim().slice(0, 300) });
    return;
  }
  if (action === "reset") toast.success("Bisect finished");
  else reportBisect(r.stdout);
}

// ── commit message, file restore, .gitignore ─────────────────────────────

export async function rewordLastCommit(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const msg = await git(root, ["log", "-1", "--format=%B"]);
  if (!msg.ok) {
    toast.error("No commits yet");
    return;
  }
  const pushed = await git(root, ["branch", "-r", "--contains", "HEAD"]);
  if (pushed.ok && pushed.stdout.trim()) {
    if (!(await confirmPick("The last commit is already pushed", "Reword anyway (needs a force push)", pushed.stdout.trim().split("\n")[0].trim()))) return;
  }
  const lines = msg.stdout.replace(/\s+$/, "").split("\n");
  const subject = await inputBox({ title: "Commit subject", value: lines[0] });
  if (!subject?.trim()) return;
  const body = lines.slice(1).join("\n").replace(/^\n+/, "");
  // --only with no paths amends just the message, leaving staged changes staged.
  const out = await gitOrToast(root, ["commit", "--amend", "--only", "--allow-empty", "-m", body ? `${subject.trim()}\n\n${body}` : subject.trim()], "Reword");
  if (out !== null) toast.success("Commit reworded");
}

export async function restoreFileFromRef(): Promise<void> {
  const path = getActiveEditor()?.path;
  if (!path) {
    toast.error("Open the file to restore in the editor first");
    return;
  }
  const root = await requireRepo();
  if (!root) return;
  const rel = relativeToRoot(root, path);
  const [refs, log] = await Promise.all([
    git(root, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads", "refs/remotes"]),
    git(root, ["log", `--format=${LOG_FORMAT}`, "-n", "50", "--", rel]),
  ]);
  const ref = await quickPick(
    [
      ...refs.stdout.split("\n").filter((r) => r && !r.endsWith("/HEAD")).map((r) => ({ label: r, description: "branch", value: r })),
      ...parseLog(log.stdout).map((c) => ({ label: c.subject, description: `${c.short} · ${c.when}`, keywords: [c.sha], value: c.sha })),
    ],
    { title: `Restore ${rel} from…` },
  );
  if (!ref) return;
  if (!(await confirmPick(`Replace ${rel} with its version from ${ref.slice(0, 12)}?`, "Restore file", "Unsaved and uncommitted edits to this file are lost."))) return;
  if ((await gitOrToast(root, ["restore", "--source", ref, "--worktree", "--", rel], "Restore")) !== null) toast.success(`Restored ${rel}`);
}

export async function addToGitignore(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const path = getActiveEditor()?.path;
  const rel = path ? relativeToRoot(root, path) : null;
  const options = rel
    ? (["file", "extension", "folder"] as const).map((k) => ({ label: gitignorePatternFor(rel, k), description: { file: "this file", extension: "all files with this extension", folder: "its folder" }[k], value: gitignorePatternFor(rel, k) }))
    : [];
  const choice = await quickPickWithCustom(options, { title: "Add to .gitignore", placeholder: "Pick a pattern or type one", allowCustom: true });
  if (!choice) return;
  const pattern = ("value" in choice ? choice.value : choice.custom).trim();
  if (!pattern) return;
  const file = `${root.replace(/[\\/]+$/, "")}/.gitignore`;
  const current = await native.readFile(file).catch(() => null);
  const content = current?.kind === "text" ? current.content : "";
  const next = appendGitignore(content, pattern);
  if (next === null) {
    toast.info(`${pattern} is already in .gitignore`);
    return;
  }
  await native.writeFile(file, next);
  const tracked = rel && (await git(root, ["ls-files", "--error-unmatch", rel])).ok;
  if (tracked && pattern === gitignorePatternFor(rel, "file")) {
    if (await confirmPick(`${rel} is already tracked`, "Stop tracking it (git rm --cached)", "Ignoring only affects untracked files.")) {
      await gitOrToast(root, ["rm", "--cached", "--", rel], "Untrack");
    }
  }
  toast.success(`Added ${pattern} to .gitignore`);
}

export const GIT_EXTRA_ACTIONS: TerminalActionDescriptor[] = [
  { id: "git.stash", label: "Git: Stash changes…", keywords: ["stash", "save", "shelve", "park", "wip"], run: stashChanges },
  { id: "git.stashes", label: "Git: Stashes (apply, pop, show, drop)…", keywords: ["stash", "unstash", "pop", "apply", "shelf"], run: manageStashes },
  { id: "git.worktrees", label: "Git: Worktrees…", keywords: ["worktree", "parallel", "branch", "checkout", "agents", "multiple"], run: manageWorktrees },
  { id: "git.createTag", label: "Git: Create tag…", keywords: ["tag", "release", "version", "semver"], run: createTag },
  { id: "git.deleteTag", label: "Git: Delete tag…", keywords: ["tag", "remove", "release"], run: deleteTag },
  { id: "git.cherryPick", label: "Git: Cherry-pick commit from branch…", keywords: ["cherry-pick", "port", "backport", "copy commit"], run: cherryPick },
  { id: "git.bisect", label: "Git: Bisect (find the commit that broke it)…", keywords: ["bisect", "regression", "binary search", "bug", "culprit"], run: bisect },
  { id: "git.reword", label: "Git: Reword last commit message…", keywords: ["amend", "message", "reword", "typo", "edit commit"], run: rewordLastCommit },
  { id: "git.restoreFile", label: "Git: Restore file from branch / commit…", keywords: ["checkout", "restore", "revert file", "old version", "discard"], run: restoreFileFromRef },
  { id: "git.addToGitignore", label: "Git: Add to .gitignore…", keywords: ["ignore", "gitignore", "exclude", "untrack"], run: addToGitignore },
];
