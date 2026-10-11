// Git workflows, part two: line history, branch comparison, conventional
// commits, history search, reflog recovery, contributors, push options,
// remotes, submodules, patches, revert, squash and copying commit info.

import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { openExternalUrl } from "@/lib/external-link";
import { compactRelativeTime } from "@/lib/toolkit/compactRelativeTime";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { confirmPick, inputBox, quickPick, quickPickWithCustom } from "@/modules/quick-pick";
import { readTerminalClipboard, writeTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";
import { git, gitOrToast, requireRepo } from "./gitCli";
import { LOG_FORMAT, parseLog } from "./extras";
import {
  buildConventionalMessage,
  CONVENTIONAL_TYPES,
  parseBlamePorcelain,
  parseNameStatus,
  parseReflog,
  parseRemotes,
  parseShortlog,
  parseSubmodules,
  pullRequestNumber,
  REFLOG_FORMAT,
  remoteWebUrl,
  STATUS_LABEL,
  suggestScopes,
} from "./extras2";

const rel = (root: string, p: string) => p.replace(/\\/g, "/").slice(root.replace(/\\/g, "/").replace(/\/+$/, "").length + 1);

async function copy(text: string, what: string) {
  await writeTerminalClipboard(text);
  toast.success(`Copied ${what}`, { description: text.length > 80 ? `${text.slice(0, 80)}…` : text });
}

async function webUrl(root: string): Promise<string | null> {
  const r = await git(root, ["remote", "get-url", "origin"]);
  return r.ok ? remoteWebUrl(r.stdout.trim()) : null;
}

function commitUrl(base: string, sha: string) {
  return /gitlab/.test(base) ? `${base}/-/commit/${sha}` : /bitbucket/.test(base) ? `${base}/commits/${sha}` : `${base}/commit/${sha}`;
}

function prUrl(base: string, n: number) {
  return /gitlab/.test(base) ? `${base}/-/merge_requests/${n}` : /bitbucket/.test(base) ? `${base}/pull-requests/${n}` : `${base}/pull/${n}`;
}

function openCommitFile(root: string, sha: string, subject: string, path: string, from: string | null) {
  app().openCommitFileDiff({ repoRoot: root, sha, shortSha: sha.slice(0, 7), subject, path, originalPath: from });
}

/** Pick a file changed in `sha` and open its diff. */
async function browseCommitFiles(root: string, sha: string, subject: string) {
  const r = await git(root, ["show", "--name-status", "--format=", "-M", sha]);
  const files = parseNameStatus(r.stdout);
  const f = await quickPick(files.map((x) => ({ label: x.path, description: STATUS_LABEL[x.status] ?? x.status, value: x })), { title: subject });
  if (f) openCommitFile(root, sha, subject, f.path, f.from);
}

// ── line history ──────────────────────────────────────────────────────────

export async function lineCommitDetails(): Promise<void> {
  const ed = getActiveEditor();
  if (!ed?.path) return void toast.error("Open a file in the editor first");
  const root = await requireRepo();
  if (!root) return;
  const line = ed.view.state.doc.lineAt(ed.view.state.selection.main.head).number;
  const r = await git(root, ["blame", "--porcelain", "-L", `${line},${line}`, "--", rel(root, ed.path)]);
  const b = r.ok ? parseBlamePorcelain(r.stdout) : null;
  if (!b) return void toast.error("No blame for this line", { description: r.stderr.trim().slice(0, 200) });
  if (b.uncommitted) return void toast.info("This line has uncommitted changes");
  const body = (await git(root, ["show", "-s", "--format=%B", b.sha])).stdout.trim();
  const base = await webUrl(root);
  const pr = pullRequestNumber(b.summary);
  const action = await quickPick(
    [
      { label: "Show files changed in this commit", value: "files" },
      { label: "Copy commit SHA", description: b.sha.slice(0, 12), value: "sha" },
      { label: "Copy commit message", value: "msg" },
      ...(base ? [{ label: "Open commit on the web", value: "web" }] : []),
      ...(base && pr ? [{ label: `Open pull request #${pr}`, value: "pr" }] : []),
    ],
    { title: `${b.summary} — ${b.author}, ${compactRelativeTime(b.time, Date.now())}`, placeholder: body.split("\n").slice(2).join(" ").slice(0, 120) || b.email },
  );
  if (action === "files") await browseCommitFiles(root, b.sha, b.summary);
  else if (action === "sha") await copy(b.sha, "SHA");
  else if (action === "msg") await copy(body, "message");
  else if (action === "web" && base) await openExternalUrl(commitUrl(base, b.sha));
  else if (action === "pr" && base && pr) await openExternalUrl(prUrl(base, pr));
}

// ── branches ──────────────────────────────────────────────────────────────

async function pickRef(root: string, title: string): Promise<string | undefined> {
  const r = await git(root, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads", "refs/remotes", "refs/tags"]);
  return quickPick(r.stdout.split("\n").filter((x) => x && !x.endsWith("/HEAD")).map((x) => ({ label: x, value: x })), { title });
}

export async function compareBranch(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const other = await pickRef(root, "Compare the current branch with…");
  if (!other) return;
  const [counts, ahead, behind, files] = await Promise.all([
    git(root, ["rev-list", "--left-right", "--count", `HEAD...${other}`]),
    git(root, ["log", `--format=${LOG_FORMAT}`, "-n", "100", `${other}..HEAD`]),
    git(root, ["log", `--format=${LOG_FORMAT}`, "-n", "100", `HEAD..${other}`]),
    git(root, ["diff", "--name-status", "-M", `${other}...HEAD`]),
  ]);
  const [a, b] = counts.stdout.trim().split(/\s+/).map(Number);
  type Item = { kind: "file"; f: ReturnType<typeof parseNameStatus>[number] } | { kind: "commit"; c: ReturnType<typeof parseLog>[number] };
  const pick = await quickPick<Item>(
    [
      ...parseNameStatus(files.stdout).map((f) => ({ label: f.path, description: `file ${STATUS_LABEL[f.status] ?? f.status} since ${other}`, value: { kind: "file" as const, f } })),
      ...parseLog(ahead.stdout).map((c) => ({ label: `↑ ${c.subject}`, description: `${c.short} · only here · ${c.when}`, value: { kind: "commit" as const, c } })),
      ...parseLog(behind.stdout).map((c) => ({ label: `↓ ${c.subject}`, description: `${c.short} · only on ${other} · ${c.when}`, value: { kind: "commit" as const, c } })),
    ],
    { title: `HEAD is ${a} ahead, ${b} behind ${other}`, emptyText: "The branches are identical" },
  );
  if (!pick) return;
  if (pick.kind === "commit") return browseCommitFiles(root, pick.c.sha, pick.c.subject);
  if (pick.f.status === "D") return void toast.info("That file was deleted on this branch");
  app().openFile(`${root}/${pick.f.path}`);
}

export async function changedSinceBase(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const head = await git(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  const base = head.ok ? head.stdout.trim() : (await git(root, ["rev-parse", "--verify", "--quiet", "main"])).ok ? "main" : "master";
  const r = await git(root, ["diff", "--name-status", "-M", `${base}...HEAD`]);
  const pick = await quickPick(
    parseNameStatus(r.stdout).map((f) => ({ label: f.path, description: STATUS_LABEL[f.status] ?? f.status, value: f })),
    { title: `Files changed on this branch since ${base}`, emptyText: `Nothing changed since ${base}` },
  );
  if (pick) pick.status === "D" ? toast.info("That file was deleted") : app().openFile(`${root}/${pick.path}`);
}

// ── committing ────────────────────────────────────────────────────────────

export async function conventionalCommit(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const staged = await git(root, ["diff", "--cached", "--name-only"]);
  const paths = staged.stdout.split("\n").filter(Boolean);
  if (!paths.length) return void toast.info("Nothing staged", { description: "Stage changes first (git add / Source Control)." });
  const type = await quickPick(CONVENTIONAL_TYPES.map((t) => ({ label: t.type, description: t.description, value: t.type })), { title: `Commit ${paths.length} staged file(s): type` });
  if (!type) return;
  const scopeChoice = await quickPickWithCustom(
    [{ label: "(no scope)", value: "" }, ...suggestScopes(paths).map((s) => ({ label: s, value: s }))],
    { title: "Scope", placeholder: "Pick or type a scope", allowCustom: true },
  );
  if (!scopeChoice) return;
  const scope = "value" in scopeChoice ? scopeChoice.value : scopeChoice.custom;
  const subject = await inputBox({ title: `${type}${scope ? `(${scope})` : ""}: …`, placeholder: "imperative summary, e.g. add OAuth login" });
  if (!subject?.trim()) return;
  const body = await inputBox({ title: "Body (optional) — why, not what", placeholder: "Use \\n for new lines" });
  if (body === undefined) return;
  const breaking = await confirmPick("Is this a breaking change?", "Yes, breaking", "Adds ! and a BREAKING CHANGE footer");
  const issues = await inputBox({ title: "Issue references (optional)", placeholder: "12, #34, PROJ-56" });
  if (issues === undefined) return;
  const msg = buildConventionalMessage({ type, scope, breaking, subject, body: body.replace(/\\n/g, "\n"), issues });
  if (!(await confirmPick("Commit with this message?", "Commit", msg))) return;
  if ((await gitOrToast(root, ["commit", "-m", msg], "Commit")) !== null) toast.success("Committed", { description: msg.split("\n")[0] });
}

export async function searchHistory(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const mode = await quickPick(
    [
      { label: "Commit message contains…", value: "--grep" },
      { label: "Author is…", value: "--author" },
      { label: "Code added or removed: exact text (pickaxe -S)", value: "-S" },
      { label: "Code changes matching a regex (-G)", value: "-G" },
    ],
    { title: "Search git history" },
  );
  if (!mode) return;
  const q = await inputBox({ title: "Search for", placeholder: mode === "--author" ? "name or e-mail" : "text" });
  if (!q) return;
  const args = ["log", `--format=${LOG_FORMAT}`, "-n", "300", mode === "-S" || mode === "-G" ? `${mode}${q}` : `${mode}=${q}`, ...(mode === "--grep" ? ["-i"] : [])];
  const t = toast.loading("Searching history…");
  const r = await git(root, args, 120);
  toast.dismiss(t);
  const c = await quickPick(
    parseLog(r.stdout).map((x) => ({ label: x.subject, description: `${x.short} · ${x.author} · ${x.when}`, keywords: [x.sha], value: x })),
    { title: `Commits matching ${q}`, emptyText: "No commits found" },
  );
  if (c) await browseCommitFiles(root, c.sha, c.subject);
}

export async function reflogRecovery(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const r = await git(root, ["reflog", `--format=${REFLOG_FORMAT}`, "-n", "200"]);
  const e = await quickPick(
    parseReflog(r.stdout).map((x) => ({ label: `${x.action}: ${x.message}`, description: `${x.sha.slice(0, 8)} · ${x.ref} · ${x.when}`, value: x })),
    { title: "Reflog — everywhere HEAD has been", placeholder: "Find the state you want back (lost commits, before a rebase/reset…)" },
  );
  if (!e) return;
  const action = await quickPick(
    [
      { label: "Create a branch here (safe)", value: "branch" },
      { label: "Check it out (detached HEAD)", value: "checkout" },
      { label: "Show files changed", value: "files" },
      { label: "Reset current branch to it (hard — discards local changes)", value: "reset" },
      { label: "Copy SHA", value: "copy" },
    ],
    { title: `${e.sha.slice(0, 8)} ${e.action}: ${e.message}` },
  );
  if (action === "copy") return copy(e.sha, "SHA");
  if (action === "files") return browseCommitFiles(root, e.sha, e.message);
  if (action === "branch") {
    const name = await inputBox({ title: "New branch name", value: `recovered-${e.sha.slice(0, 7)}` });
    if (name && (await gitOrToast(root, ["branch", name, e.sha], "Create branch")) !== null) toast.success(`Created ${name} at ${e.sha.slice(0, 7)}`);
  } else if (action === "checkout") {
    if ((await gitOrToast(root, ["checkout", e.sha], "Checkout")) !== null) toast.success(`Checked out ${e.sha.slice(0, 7)} (detached)`);
  } else if (action === "reset") {
    if (!(await confirmPick("Hard reset discards uncommitted changes", "Reset --hard", e.sha))) return;
    if ((await gitOrToast(root, ["reset", "--hard", e.sha], "Reset")) !== null) toast.success(`Reset to ${e.sha.slice(0, 7)}`);
  }
}

export async function contributors(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const r = await git(root, ["shortlog", "-sne", "HEAD"], 60);
  const list = parseShortlog(r.stdout);
  const total = list.reduce((n, c) => n + c.commits, 0);
  const pick = await quickPick(
    list.map((c) => ({ label: c.name, description: `${c.commits} commits · ${((c.commits / Math.max(total, 1)) * 100).toFixed(1)}% · ${c.email}`, value: c.email })),
    { title: `${list.length} contributors, ${total} commits`, placeholder: "Pick one to see their recent commits" },
  );
  if (!pick) return;
  const log = await git(root, ["log", `--format=${LOG_FORMAT}`, "-n", "100", `--author=${pick}`]);
  const c = await quickPick(parseLog(log.stdout).map((x) => ({ label: x.subject, description: `${x.short} · ${x.when}`, value: x })), { title: pick });
  if (c) await browseCommitFiles(root, c.sha, c.subject);
}

// ── remote operations ─────────────────────────────────────────────────────

export async function pushWithOptions(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const branch = (await git(root, ["branch", "--show-current"])).stdout.trim();
  if (!branch) return void toast.error("Not on a branch (detached HEAD)");
  const opt = await quickPick(
    [
      { label: "Push", value: ["push"] },
      { label: "Push and set upstream", description: `origin ${branch}`, value: ["push", "-u", "origin", branch] },
      { label: "Force push with lease (safe force)", description: "after rebase/amend; refuses if someone else pushed", value: ["push", "--force-with-lease", "--force-if-includes"] },
      { label: "Push tags too", value: ["push", "--follow-tags"] },
      { label: "Dry run", value: ["push", "--dry-run"] },
    ],
    { title: `Push ${branch}` },
  );
  if (!opt) return;
  const t = toast.loading("Pushing…");
  const r = await git(root, opt, 120);
  toast.dismiss(t);
  if (r.ok) toast.success("Pushed", { description: (r.stderr || r.stdout).trim().split("\n").slice(-1)[0] });
  else toast.error("Push failed", { description: r.stderr.trim().slice(0, 400) });
}

export async function manageRemotes(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const remotes = parseRemotes((await git(root, ["remote", "-v"])).stdout);
  const pick = await quickPick(
    [...remotes.map((r) => ({ label: r.name, description: r.fetch, value: r.name as string | null })), { label: "＋ Add remote…", value: null }],
    { title: "Remotes" },
  );
  if (pick === undefined) return;
  if (pick === null) {
    const name = await inputBox({ title: "Remote name", value: remotes.length ? "upstream" : "origin" });
    if (!name) return;
    const clip = (await readTerminalClipboard()).trim();
    const url = await inputBox({ title: `URL for ${name}`, value: /^(https?:|git@|ssh:)/.test(clip) ? clip : "" });
    if (!url) return;
    if ((await gitOrToast(root, ["remote", "add", name, url], "Add remote")) !== null) toast.success(`Added ${name}`);
    return;
  }
  const r = remotes.find((x) => x.name === pick)!;
  const web = remoteWebUrl(r.fetch);
  const action = await quickPick(
    [
      { label: "Fetch", value: "fetch" },
      ...(web ? [{ label: "Open on the web", value: "web" }] : []),
      { label: "Copy URL", value: "copy" },
      { label: "Change URL…", value: "seturl" },
      { label: "Rename…", value: "rename" },
      { label: "Remove", value: "remove" },
    ],
    { title: `${r.name} — ${r.fetch}` },
  );
  if (action === "fetch") (await gitOrToast(root, ["fetch", "--prune", r.name], "Fetch")) !== null && toast.success(`Fetched ${r.name}`);
  else if (action === "web" && web) await openExternalUrl(web);
  else if (action === "copy") await copy(r.fetch, "URL");
  else if (action === "seturl") {
    const url = await inputBox({ title: `New URL for ${r.name}`, value: r.fetch });
    if (url && (await gitOrToast(root, ["remote", "set-url", r.name, url], "Set URL")) !== null) toast.success("URL updated");
  } else if (action === "rename") {
    const name = await inputBox({ title: `Rename ${r.name} to`, value: r.name });
    if (name && name !== r.name && (await gitOrToast(root, ["remote", "rename", r.name, name], "Rename")) !== null) toast.success(`Renamed to ${name}`);
  } else if (action === "remove" && (await confirmPick(`Remove remote ${r.name}?`, "Remove"))) {
    if ((await gitOrToast(root, ["remote", "remove", r.name], "Remove")) !== null) toast.success(`Removed ${r.name}`);
  }
}

export async function submodules(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const list = parseSubmodules((await git(root, ["submodule", "status"])).stdout);
  const pick = await quickPick(
    [
      { label: "Update all (init + recursive)", value: "__all" },
      ...list.map((s) => ({ label: s.path, description: `${s.state}${s.describe ? ` · ${s.describe}` : ""} · ${s.sha.slice(0, 8)}`, value: s.path })),
    ],
    { title: `${list.length} submodule${list.length === 1 ? "" : "s"}`, emptyText: "No submodules" },
  );
  if (!pick) return;
  if (pick === "__all") {
    const t = toast.loading("Updating submodules…");
    const r = await git(root, ["submodule", "update", "--init", "--recursive"], 600);
    toast.dismiss(t);
    return void (r.ok ? toast.success("Submodules updated") : toast.error("Update failed", { description: r.stderr.trim().slice(0, 300) }));
  }
  const action = await quickPick(
    [
      { label: "Open terminal in it", value: "term" },
      { label: "Update to the recorded commit", value: "update" },
      { label: "Pull its latest upstream (remote)", value: "remote" },
    ],
    { title: pick },
  );
  if (action === "term") app().openTerminal({ cwd: `${root}/${pick}` });
  else if (action) {
    const args = ["submodule", "update", "--init", ...(action === "remote" ? ["--remote"] : []), "--", pick];
    if ((await gitOrToast(root, args, "Submodule update")) !== null) toast.success(`Updated ${pick}`);
  }
}

// ── patches, revert, squash, copy ─────────────────────────────────────────

export async function createPatch(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const what = await quickPick(
    [
      { label: "Uncommitted changes (working tree + staged)", value: ["diff", "HEAD"] },
      { label: "Staged changes only", value: ["diff", "--cached"] },
      { label: "The last commit", value: ["format-patch", "-1", "HEAD", "--stdout"] },
      { label: "All commits on this branch since main", value: ["format-patch", "main..HEAD", "--stdout"] },
    ],
    { title: "Create a patch (copied to the clipboard)" },
  );
  if (!what) return;
  const r = await git(root, what, 60);
  if (!r.ok || !r.stdout.trim()) return void toast.info("Nothing to put in a patch", { description: r.stderr.trim().slice(0, 200) || undefined });
  await copy(r.stdout, "patch");
}

export async function applyPatchFromClipboard(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const patch = await readTerminalClipboard();
  if (!/^(diff --git|From [0-9a-f]{40}|---\s|Index: )/m.test(patch)) return void toast.info("The clipboard doesn't contain a patch");
  const dir = `${root}/.git`;
  const file = `${dir}/gear-clipboard.patch`;
  const { native } = await import("@/modules/ai/lib/native");
  await native.writeFile(file, patch.endsWith("\n") ? patch : `${patch}\n`, "user");
  const isMail = /^From [0-9a-f]{40}/m.test(patch);
  const check = await git(root, isMail ? ["am", "--3way", file] : ["apply", "--3way", "--check", file]);
  if (isMail) return void (check.ok ? toast.success("Applied patch as commits (git am)") : toast.error("git am failed — run `git am --abort` to undo", { description: check.stderr.trim().slice(0, 300) }));
  if (!check.ok) return void toast.error("The patch doesn't apply cleanly", { description: check.stderr.trim().slice(0, 300) });
  if ((await gitOrToast(root, ["apply", "--3way", file], "Apply patch")) !== null) toast.success("Patch applied to the working tree");
}

export async function revertCommit(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const log = await git(root, ["log", `--format=${LOG_FORMAT}`, "-n", "100"]);
  const c = await quickPick(parseLog(log.stdout).map((x) => ({ label: x.subject, description: `${x.short} · ${x.author} · ${x.when}`, value: x })), { title: "Revert a commit (creates a new commit that undoes it)" });
  if (!c || !(await confirmPick(`Revert “${c.subject}”?`, "Revert"))) return;
  const r = await git(root, ["revert", "--no-edit", c.sha]);
  if (r.ok) toast.success(`Reverted ${c.short}`);
  else toast.error("Revert stopped (conflicts?) — resolve, then `git revert --continue`", { description: (r.stderr || r.stdout).trim().slice(0, 300) });
}

export async function squashLast(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const log = parseLog((await git(root, ["log", `--format=${LOG_FORMAT}`, "-n", "20"])).stdout);
  const n = await quickPick(
    log.slice(1).map((c, i) => ({ label: `Squash the last ${i + 2} commits`, description: `down to “${c.subject}”`, value: i + 2 })),
    { title: "Squash recent commits into one" },
  );
  if (!n) return;
  const pushed = await git(root, ["branch", "-r", "--contains", `HEAD~${n - 1}`]);
  if (pushed.stdout.trim() && !(await confirmPick("Some of these commits are already pushed", "Squash anyway (needs a force push)"))) return;
  const msgs = (await git(root, ["log", "--format=%B", "-n", String(n)])).stdout.trim();
  const subject = await inputBox({ title: "Message for the squashed commit", value: log[n - 1].subject });
  if (!subject) return;
  if ((await gitOrToast(root, ["reset", "--soft", `HEAD~${n}`], "Squash")) === null) return;
  const body = msgs.split("\n").filter((l) => l.trim()).map((l) => `* ${l}`).join("\n");
  if ((await gitOrToast(root, ["commit", "-m", `${subject}\n\n${body}`], "Commit")) !== null) toast.success(`Squashed ${n} commits`);
}

export async function copyFromLog(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const log = await git(root, ["log", `--format=${LOG_FORMAT}`, "-n", "200"]);
  const c = await quickPick(parseLog(log.stdout).map((x) => ({ label: x.subject, description: `${x.short} · ${x.author} · ${x.when}`, keywords: [x.sha], value: x })), { title: "Copy from history" });
  if (!c) return;
  const what = await quickPick(
    [
      { label: "Full SHA", description: c.sha, value: c.sha },
      { label: "Short SHA", description: c.short, value: c.short },
      { label: "Subject", value: c.subject },
      { label: "“sha subject” reference", value: `${c.short} ${c.subject}` },
    ],
    { title: c.subject },
  );
  if (what) await copy(what, "commit info");
}

export const GIT_EXTRA_ACTIONS_2 = [
  { id: "git.lineCommit", label: "Git: Commit that last changed this line…", keywords: ["blame", "who", "why", "line", "history", "pull request"], run: lineCommitDetails },
  { id: "git.compareBranch", label: "Git: Compare current branch with…", keywords: ["compare", "diff", "ahead", "behind", "branch", "changes"], run: compareBranch },
  { id: "git.changedSinceBase", label: "Git: Files changed on this branch", keywords: ["changed", "files", "since main", "pr", "diff"], run: changedSinceBase },
  { id: "git.conventionalCommit", label: "Git: Commit staged changes (conventional commit)…", keywords: ["commit", "conventional", "feat", "fix", "message", "semantic"], run: conventionalCommit },
  { id: "git.searchHistory", label: "Git: Search history (message, author, code)…", keywords: ["log", "search", "grep", "pickaxe", "author", "when was"], run: searchHistory },
  { id: "git.reflog", label: "Git: Recover from reflog (undo resets, rebases, lost commits)…", keywords: ["reflog", "recover", "undo", "lost", "reset", "rescue"], run: reflogRecovery },
  { id: "git.contributors", label: "Git: Contributors", keywords: ["shortlog", "authors", "contributors", "stats", "who"], run: contributors },
  { id: "git.pushOptions", label: "Git: Push with options (upstream, force-with-lease, tags)…", keywords: ["push", "force", "lease", "upstream", "tags", "dry run"], run: pushWithOptions },
  { id: "git.remotes", label: "Git: Remotes…", keywords: ["remote", "origin", "upstream", "fork", "url"], run: manageRemotes },
  { id: "git.submodules", label: "Git: Submodules…", keywords: ["submodule", "update", "init", "vendor"], run: submodules },
  { id: "git.createPatch", label: "Git: Create patch (to clipboard)…", keywords: ["patch", "diff", "format-patch", "share", "email"], run: createPatch },
  { id: "git.applyPatch", label: "Git: Apply patch from clipboard", keywords: ["patch", "apply", "am", "diff"], run: applyPatchFromClipboard },
  { id: "git.revert", label: "Git: Revert a commit…", keywords: ["revert", "undo", "rollback"], run: revertCommit },
  { id: "git.squash", label: "Git: Squash recent commits…", keywords: ["squash", "combine", "fixup", "clean history"], run: squashLast },
  { id: "git.copyFromLog", label: "Git: Copy commit SHA / message…", keywords: ["sha", "hash", "copy", "commit id", "reference"], run: copyFromLog },
];
