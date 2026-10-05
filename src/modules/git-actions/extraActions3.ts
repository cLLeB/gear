// Git workflows, part three: ownership, file at a revision, stage/discard the
// current file, commit graph, rename/delete branches, sync, history of the
// selected lines, repository identity and an activity summary.

import { toast } from "sonner";
import { compactRelativeTime } from "@/lib/toolkit/compactRelativeTime";
import { openTextViewer } from "@/modules/compare/CompareDialog";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { confirmPick, inputBox, quickPick } from "@/modules/quick-pick";
import { git, gitOrToast, requireRepo } from "./gitCli";
import { LOG_FORMAT, parseLog } from "./extras";
import { branchNameProblem, parseActivity, parseOwnership, sparkline } from "./extras3";

const rel = (root: string, p: string) => p.replace(/\\/g, "/").slice(root.replace(/\\/g, "/").replace(/\/+$/, "").length + 1);

async function fileInRepo(): Promise<{ root: string; path: string; rel: string } | null> {
  const path = getActiveEditor()?.path;
  if (!path) {
    toast.error("Open a file in the editor first");
    return null;
  }
  const root = await requireRepo();
  return root ? { root, path, rel: rel(root, path) } : null;
}

export async function codeOwnership(): Promise<void> {
  const f = await fileInRepo();
  if (!f) return;
  const r = await git(f.root, ["blame", "--line-porcelain", "-w", "-M", "--", f.rel], 60);
  if (!r.ok) return void toast.error("Blame failed", { description: r.stderr.trim().slice(0, 200) });
  const owners = parseOwnership(r.stdout);
  const now = Date.now();
  await quickPick(
    owners.map((o) => ({ label: `${o.author}`, description: `${(o.share * 100).toFixed(1)}% · ${o.lines} lines · last change ${compactRelativeTime(o.lastTime, now)}`, value: o.author })),
    { title: `Who wrote ${f.rel}`, emptyText: "No committed lines" },
  );
}

export async function fileAtRevision(): Promise<void> {
  const f = await fileInRepo();
  if (!f) return;
  const log = await git(f.root, ["log", `--format=${LOG_FORMAT}`, "-n", "100", "--follow", "--", f.rel]);
  const refs = await git(f.root, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads", "refs/remotes", "refs/tags"]);
  const pick = await quickPick(
    [
      ...parseLog(log.stdout).map((c) => ({ label: c.subject, description: `${c.short} · ${c.when}`, value: c.sha })),
      ...refs.stdout.split("\n").filter((x) => x && !x.endsWith("/HEAD")).map((x) => ({ label: x, description: "branch / tag", value: x })),
    ],
    { title: `${f.rel} at…` },
  );
  if (!pick) return;
  const show = await git(f.root, ["show", `${pick}:${f.rel}`]);
  if (!show.ok) return void toast.error("That revision doesn't contain this file", { description: show.stderr.trim().slice(0, 200) });
  openTextViewer(`${f.rel} @ ${pick.slice(0, 12)}`, show.stdout, f.path);
}

export async function stageCurrentFile(): Promise<void> {
  const f = await fileInRepo();
  if (!f) return;
  const status = (await git(f.root, ["status", "--porcelain", "--", f.rel])).stdout;
  const staged = /^[MADRC]/.test(status);
  const unstagedChanges = /^.[MD?]/.test(status) || status.startsWith("??");
  const action = await quickPick(
    [
      ...(unstagedChanges || !status ? [{ label: "Stage this file", value: "stage" }] : []),
      ...(staged ? [{ label: "Unstage this file", value: "unstage" }] : []),
    ],
    { title: `${f.rel}${status ? ` (${status.slice(0, 2).trim() || "clean"})` : " (no changes)"}`, emptyText: "No changes to stage or unstage" },
  );
  if (action === "stage") (await gitOrToast(f.root, ["add", "--", f.rel], "Stage")) !== null && toast.success(`Staged ${f.rel}`);
  else if (action === "unstage") (await gitOrToast(f.root, ["restore", "--staged", "--", f.rel], "Unstage")) !== null && toast.success(`Unstaged ${f.rel}`);
}

export async function discardFileChanges(): Promise<void> {
  const f = await fileInRepo();
  if (!f) return;
  const status = (await git(f.root, ["status", "--porcelain", "--", f.rel])).stdout;
  if (!status.trim()) return void toast.info("No changes in this file");
  if (status.startsWith("??")) return void toast.info("The file is untracked — delete it instead if you don't want it");
  if (!(await confirmPick(`Discard all changes to ${f.rel}?`, "Discard (staged and unstaged)", "This can't be undone from git."))) return;
  if ((await gitOrToast(f.root, ["restore", "--staged", "--worktree", "--source=HEAD", "--", f.rel], "Discard")) !== null) toast.success(`Restored ${f.rel} to HEAD`);
}

export async function commitGraph(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const scope = await quickPick(
    [
      { label: "All branches", value: ["--all"] },
      { label: "Current branch", value: [] as string[] },
    ],
    { title: "Commit graph" },
  );
  if (!scope) return;
  const r = await git(root, ["log", "--graph", "--decorate", "--date=short", "--format=%h %ad %d %s (%an)", "-n", "400", ...scope], 60);
  openTextViewer("Commit graph", r.stdout || r.stderr);
}

export async function renameOrDeleteBranch(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const current = (await git(root, ["branch", "--show-current"])).stdout.trim();
  const r = await git(root, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)\x1f%(upstream:short)\x1f%(committerdate:relative)", "refs/heads"]);
  const branches = r.stdout.split("\n").filter(Boolean).map((l) => l.split("\x1f"));
  const b = await quickPick(branches.map(([name, up, when]) => ({ label: `${name === current ? "● " : ""}${name}`, description: [up && `→ ${up}`, when].filter(Boolean).join(" · "), value: { name, up } })), { title: "Rename or delete a branch" });
  if (!b) return;
  const action = await quickPick(
    [
      { label: "Rename…", value: "rename" },
      ...(b.name !== current ? [{ label: "Delete (local)", value: "delete" }] : []),
      ...(b.up ? [{ label: `Delete on the remote (${b.up})`, value: "remote" }] : []),
    ],
    { title: b.name },
  );
  if (action === "rename") {
    const name = await inputBox({ title: `Rename ${b.name} to`, value: b.name });
    if (!name || name === b.name) return;
    const problem = branchNameProblem(name);
    if (problem) return void toast.error(`Invalid name: ${problem}`);
    if ((await gitOrToast(root, ["branch", "-m", b.name, name], "Rename")) !== null) toast.success(`Renamed to ${name}`, { description: b.up ? "The remote branch keeps its old name until you push the new one." : undefined });
  } else if (action === "delete") {
    let r2 = await git(root, ["branch", "-d", b.name]);
    if (!r2.ok && /not fully merged/.test(r2.stderr)) {
      if (!(await confirmPick(`${b.name} has unmerged commits`, "Delete anyway (-D)"))) return;
      r2 = await git(root, ["branch", "-D", b.name]);
    }
    if (r2.ok) toast.success(`Deleted ${b.name}`);
    else toast.error("Delete failed", { description: r2.stderr.trim().slice(0, 200) });
  } else if (action === "remote" && b.up) {
    const [remote, ...rest] = b.up.split("/");
    if (!(await confirmPick(`Delete ${b.up} for everyone?`, "Delete remote branch"))) return;
    if ((await gitOrToast(root, ["push", remote, "--delete", rest.join("/")], "Delete remote branch")) !== null) toast.success(`Deleted ${b.up}`);
  }
}

export async function syncBranch(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const branch = (await git(root, ["branch", "--show-current"])).stdout.trim();
  if (!branch) return void toast.error("Not on a branch");
  const t = toast.loading(`Syncing ${branch}…`);
  try {
    const pull = await git(root, ["pull", "--rebase", "--autostash"], 120);
    if (!pull.ok) return void toast.error("Pull --rebase stopped", { description: `${pull.stderr.trim().slice(0, 300)}\nResolve, then git rebase --continue (or --abort).` });
    const ahead = (await git(root, ["rev-list", "--count", "@{u}..HEAD"])).stdout.trim();
    if (ahead && ahead !== "0") {
      const push = await git(root, ["push"], 120);
      if (!push.ok) return void toast.error("Push failed", { description: push.stderr.trim().slice(0, 300) });
    }
    toast.success(`${branch} is in sync`, { description: ahead && ahead !== "0" ? `Pushed ${ahead} commit(s)` : "Nothing to push" });
  } finally {
    toast.dismiss(t);
  }
}

export async function selectedLinesHistory(): Promise<void> {
  const f = await fileInRepo();
  if (!f) return;
  const { view } = getActiveEditor()!;
  const sel = view.state.selection.main;
  const a = view.state.doc.lineAt(sel.from).number;
  const b = view.state.doc.lineAt(sel.to).number;
  const t = toast.loading("Tracing line history…");
  const r = await git(f.root, ["log", `-L${a},${b}:${f.rel}`, "--no-color", "-n", "50"], 120);
  toast.dismiss(t);
  if (!r.ok) return void toast.error("git log -L failed", { description: r.stderr.trim().slice(0, 200) });
  openTextViewer(`History of ${f.rel}:${a}${b > a ? `-${b}` : ""}`, r.stdout || "No history (uncommitted lines?)", "history.diff");
}

export async function repoIdentity(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const [name, email, gname, gemail] = await Promise.all([
    git(root, ["config", "--local", "user.name"]),
    git(root, ["config", "--local", "user.email"]),
    git(root, ["config", "--global", "user.name"]),
    git(root, ["config", "--global", "user.email"]),
  ]);
  const effective = `${(name.stdout || gname.stdout).trim()} <${(email.stdout || gemail.stdout).trim()}>`;
  const action = await quickPick(
    [
      { label: `Commits here are by: ${effective}`, description: name.stdout.trim() ? "set for this repo" : "from global config", value: "" },
      { label: "Set name & e-mail for this repository…", value: "set" },
      ...(name.stdout.trim() || email.stdout.trim() ? [{ label: "Use the global identity here (remove repo override)", value: "unset" }] : []),
    ],
    { title: "Git identity" },
  );
  if (action === "set") {
    const n = await inputBox({ title: "Name", value: (name.stdout || gname.stdout).trim() });
    if (!n) return;
    const e = await inputBox({ title: "E-mail (e.g. a work address or GitHub noreply)", value: (email.stdout || gemail.stdout).trim() });
    if (!e) return;
    await gitOrToast(root, ["config", "--local", "user.name", n], "Set name");
    if ((await gitOrToast(root, ["config", "--local", "user.email", e], "Set e-mail")) !== null) toast.success(`This repo now commits as ${n} <${e}>`);
  } else if (action === "unset") {
    await git(root, ["config", "--local", "--unset", "user.name"]);
    await git(root, ["config", "--local", "--unset", "user.email"]);
    toast.success("Using the global identity");
  }
}

export async function activitySummary(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const period = await quickPick(
    [
      { label: "This week (7 days)", value: 7 },
      { label: "Last 30 days", value: 30 },
      { label: "Last 90 days", value: 90 },
    ],
    { title: "My git activity" },
  );
  if (!period) return;
  const email = (await git(root, ["config", "user.email"])).stdout.trim();
  const r = await git(root, ["log", "--all", "--no-merges", `--since=${period}.days`, `--author=${email}`, "--numstat", "--format=@%ad", "--date=short"], 60);
  const a = parseActivity(r.stdout);
  if (!a.commits) return void toast.info(`No commits by ${email} in the last ${period} days`);
  await quickPick(
    [
      { label: `${a.commits} commits · +${a.added} −${a.removed} lines · ${a.files} files`, description: email, value: "" },
      { label: sparkline(a.byDay, Math.min(period, 30)), description: `commits per day (last ${Math.min(period, 30)} days)`, value: "" },
      ...a.topFiles.map(([file, n]) => ({ label: file, description: `${n} lines changed`, value: file })),
    ],
    { title: `Activity: last ${period} days` },
  );
}

export const GIT_EXTRA_ACTIONS_3 = [
  { id: "git.ownership", label: "Git: Who wrote this file (line ownership)", keywords: ["blame", "owner", "authors", "who", "expert", "codeowners"], run: codeOwnership },
  { id: "git.fileAtRevision", label: "Git: View this file at another commit / branch…", keywords: ["show", "old version", "revision", "history", "previous"], run: fileAtRevision },
  { id: "git.stageFile", label: "Git: Stage / unstage this file", keywords: ["stage", "add", "unstage", "index"], run: stageCurrentFile },
  { id: "git.discardFile", label: "Git: Discard changes in this file…", keywords: ["discard", "revert file", "restore", "reset file", "undo changes"], run: discardFileChanges },
  { id: "git.graph", label: "Git: Commit graph", keywords: ["graph", "log", "tree", "history", "branches", "visual"], run: commitGraph },
  { id: "git.renameDeleteBranch", label: "Git: Rename or delete a branch…", keywords: ["branch", "rename", "delete", "remove", "remote branch"], run: renameOrDeleteBranch },
  { id: "git.sync", label: "Git: Sync (pull --rebase, then push)", keywords: ["sync", "pull", "rebase", "push", "update"], run: syncBranch },
  { id: "git.lineHistory", label: "Git: History of the selected lines", keywords: ["log -L", "line history", "function history", "evolution", "blame"], run: selectedLinesHistory },
  { id: "git.identity", label: "Git: Commit identity for this repository…", keywords: ["user.name", "user.email", "author", "identity", "work email"], run: repoIdentity },
  { id: "git.activity", label: "Git: My activity summary", keywords: ["activity", "stats", "commits", "standup", "what did i do"], run: activitySummary },
];
