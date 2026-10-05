// Git workflows, part four: stage / unstage / discard the selected lines,
// interactive-rebase planner, split the last commit per file, stale branches,
// big blobs in history, co-author trailers, oldest TODOs, previewed clean,
// cherry-pick a range, which refs contain a commit, incoming / outgoing.

import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { IS_WINDOWS } from "@/lib/platform";
import { compactRelativeTime } from "@/lib/toolkit/compactRelativeTime";
import { native } from "@/modules/ai/lib/native";
import { openTextViewer } from "@/modules/compare/CompareDialog";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { confirmPick, inputBox, quickPick } from "@/modules/quick-pick";
import { LOG_FORMAT, parseLog } from "./extras";
import {
  addTrailer,
  blameTimes,
  BRANCH_FORMAT,
  humanSize,
  largestBlobs,
  parseBranches,
  parseCleanDryRun,
  parseGitGrep,
  parseShortlog,
  splitCommitScript,
  staleness,
} from "./extras4";
import { git, gitOrToast, requireRepo } from "./gitCli";
import { openRebaseEditor } from "./RebaseEditorDialog";
import { applyLineRange, type PartialAction } from "./partialApply";

const rel = (root: string, p: string) => p.replace(/\\/g, "/").slice(root.replace(/\\/g, "/").replace(/\/+$/, "").length + 1);

async function selectionInRepo() {
  const ed = getActiveEditor();
  if (!ed?.path) {
    toast.error("Open a file in the editor first");
    return null;
  }
  const root = await requireRepo();
  if (!root) return null;
  const disk = await native.readFile(ed.path).catch(() => null);
  if (disk?.kind === "text" && disk.content !== ed.view.state.doc.toString()) {
    toast.error("Save the file first");
    return null;
  }
  const doc = ed.view.state.doc;
  const sel = ed.view.state.selection.main;
  const from = doc.lineAt(sel.from).number;
  const to = doc.lineAt(sel.empty ? sel.to : Math.max(sel.from, sel.to - 1)).number;
  return { root, rel: rel(root, ed.path), from, to };
}

async function applyPartial(mode: PartialAction): Promise<void> {
  const s = await selectionInRepo();
  if (!s) return;
  if (mode === "discard" && !(await confirmPick(`Discard changes in lines ${s.from}–${s.to}?`, "Discard"))) return;
  const err = await applyLineRange(s.root, s.rel, mode, s.from, s.to);
  if (err) return void toast.error(err);
  toast.success(mode === "stage" ? `Staged lines ${s.from}–${s.to}` : mode === "unstage" ? `Unstaged lines ${s.from}–${s.to}` : `Discarded lines ${s.from}–${s.to}`);
}

export async function splitLastCommit(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const subject = (await git(root, ["log", "-1", "--format=%s"])).stdout.trim();
  const files = (await git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])).stdout.split("\n").filter(Boolean);
  if (files.length < 2) return void toast.info("The last commit touches only one file");
  if (!(await confirmPick(`Split "${subject}" into ${files.length} commits (one per file)?`, "Split"))) return;
  app().openTerminal({ cwd: root, command: splitCommitScript(subject, files, IS_WINDOWS ? "powershell" : "posix") });
}

export async function staleBranches(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const head = (await git(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).stdout.trim().replace(/^origin\//, "") || "main";
  const merged = new Set((await git(root, ["branch", "--format=%(refname:short)", "--merged", head])).stdout.split("\n").map((s) => s.trim()).filter((b) => b && b !== head));
  const out = await gitOrToast(root, ["for-each-ref", `--format=${BRANCH_FORMAT}`, "refs/heads"], "Listing branches");
  if (out === null) return;
  const bs = parseBranches(out, merged).filter((b) => b.name !== head);
  const stale = bs.map((b) => ({ b, why: staleness(b) })).filter((x) => x.why.length);
  const pick = await quickPick(
    stale.map(({ b, why }) => ({ label: b.name, description: `${why.join(" · ")} · ${b.author} · ${compactRelativeTime(b.date, Date.now())}`, value: b })),
    { title: `${stale.length} stale branch(es) of ${bs.length} — pick one to delete or check out`, emptyText: "No stale branches" },
  );
  if (!pick) return;
  const act = await quickPick([{ label: "Delete (safe: -d)", value: "-d" }, { label: "Force delete (-D)", value: "-D" }, { label: "Check out", value: "co" }], { title: pick.name });
  if (!act) return;
  if (act === "co") return void (await gitOrToast(root, ["switch", pick.name], "Switch"));
  if ((await gitOrToast(root, ["branch", act, pick.name], "Delete")) !== null) toast.success(`Deleted ${pick.name}`);
}

export async function largeBlobs(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const t = toast.loading("Scanning history for large files…");
  const r = await native.runCommand(`git rev-list --objects --all | git cat-file --batch-check="%(objecttype) %(objectname) %(objectsize) %(rest)"`, root, 120).catch(() => null);
  toast.dismiss(t);
  if (!r || r.exit_code !== 0) return void toast.error(r?.stderr.trim() || "git failed");
  const blobs = largestBlobs(r.stdout, 60);
  const present = new Set((await git(root, ["ls-files"])).stdout.split("\n"));
  const total = blobs.reduce((n, b) => n + b.size, 0);
  const pick = await quickPick(
    blobs.map((b) => ({ label: `${humanSize(b.size).padStart(8)}  ${b.path || b.sha}`, description: present.has(b.path) ? "in working tree" : "history only (deleted)", value: b })),
    { title: `Largest blobs in history (top ${blobs.length} = ${humanSize(total)})` },
  );
  if (!pick) return;
  const log = await git(root, ["log", "--all", `--format=${LOG_FORMAT}`, "--", pick.path]);
  await quickPick(parseLog(log.stdout).map((c) => ({ label: c.subject, description: `${c.short} · ${c.author} · ${c.when}`, value: c.sha })), { title: `Commits touching ${pick.path}` });
}

export async function addCoAuthor(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const people = parseShortlog((await git(root, ["shortlog", "-sne", "--all", "-n"], 60)).stdout);
  const who = await quickPick(
    [...people.map((p) => ({ label: p.name, description: `${p.email} · ${p.commits} commits`, value: `${p.name} <${p.email}>` })), { label: "Someone else…", value: "" }],
    { title: "Co-author" },
  );
  if (who === undefined) return;
  const person = who || (await inputBox({ title: "Name <email>", placeholder: "Ada Lovelace <ada@example.com>" }));
  if (!person) return;
  const msg = (await git(root, ["log", "-1", "--format=%B"])).stdout;
  const next = addTrailer(msg, `Co-authored-by: ${person}`);
  if (next.trim() === msg.trim()) return void toast.info("Already a co-author");
  const gp = await git(root, ["rev-parse", "--git-path", "gear-commit-msg"]);
  const file = `${root}/${gp.stdout.trim()}`.replace(/\\/g, "/");
  await native.writeFile(file, next, "user");
  if ((await gitOrToast(root, ["commit", "--amend", "--no-verify", "-F", file], "Amend")) !== null) toast.success(`Added Co-authored-by: ${person}`);
}

export async function oldestTodos(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const t = toast.loading("Dating TODOs with git blame…");
  const hits = parseGitGrep((await git(root, ["grep", "-n", "-I", "-E", "\\b(TODO|FIXME|HACK|XXX)\\b"], 60)).stdout).slice(0, 400);
  const byFile = new Map<string, typeof hits>();
  for (const h of hits) byFile.set(h.file, [...(byFile.get(h.file) ?? []), h]);
  const rows: { file: string; line: number; text: string; time: number; author: string }[] = [];
  for (const [file, hs] of byFile) {
    const args = ["blame", "--line-porcelain", ...hs.flatMap((h) => ["-L", `${h.line},${h.line}`]), "--", file];
    const b = blameTimes((await git(root, args, 30)).stdout);
    for (const h of hs) {
      const info = b.get(h.line);
      rows.push({ ...h, time: info?.time ?? Date.now(), author: info?.author ?? "?" });
    }
  }
  toast.dismiss(t);
  rows.sort((a, b) => a.time - b.time);
  const pick = await quickPick(
    rows.map((r) => ({ label: r.text.slice(0, 120), description: `${compactRelativeTime(r.time, Date.now())} · ${r.author} · ${r.file}:${r.line}`, value: r })),
    { title: `${rows.length} TODO/FIXME comment(s), oldest first`, emptyText: "No TODOs" },
  );
  if (pick) app().openFile(`${root}/${pick.file}`, pick.line);
}

export async function cleanUntracked(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const mode = await quickPick(
    [
      { label: "Untracked files and folders", value: ["-nd"] },
      { label: "…including ignored files (build output, node_modules)", value: ["-ndx"] },
      { label: "Only ignored files", value: ["-ndX"] },
    ],
    { title: "Clean the working tree — preview first" },
  );
  if (!mode) return;
  const paths = parseCleanDryRun((await git(root, ["clean", ...mode])).stdout);
  if (!paths.length) return void toast.info("Nothing to clean");
  const go = await quickPick(
    [{ label: `🗑 Delete all ${paths.length}`, value: "all" }, { label: "Show the list", value: "show" }],
    { title: `${paths.length} path(s) would be deleted: ${paths.slice(0, 5).join(", ")}${paths.length > 5 ? "…" : ""}` },
  );
  if (go === "show") return openTextViewer("git clean preview", paths.join("\n"));
  if (go !== "all" || !(await confirmPick(`Permanently delete ${paths.length} path(s)?`, "Delete"))) return;
  if ((await gitOrToast(root, ["clean", mode[0].replace("n", "f")], "Clean")) !== null) toast.success(`Deleted ${paths.length} path(s)`);
}

export async function cherryPickRange(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const branches = (await git(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"])).stdout.split("\n").filter((b) => b && !b.endsWith("/HEAD"));
  const branch = await quickPick(branches.map((b) => ({ label: b, value: b })), { title: "Cherry-pick a range from which branch?" });
  if (!branch) return;
  const commits = parseLog((await git(root, ["log", `--format=${LOG_FORMAT}`, "-n", "50", `HEAD..${branch}`])).stdout);
  if (!commits.length) return void toast.info("No commits on that branch that aren't already here");
  const items = commits.map((c) => ({ label: c.subject, description: `${c.short} · ${c.author} · ${c.when}`, value: c.sha }));
  const first = await quickPick(items, { title: "Oldest commit to include" });
  if (!first) return;
  const last = await quickPick(items.slice(0, items.findIndex((i) => i.value === first) + 1), { title: "Newest commit to include" });
  if (!last) return;
  app().openTerminal({ cwd: root, command: `git cherry-pick -x ${first}^..${last}` });
}

export async function refsContaining(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const commits = parseLog((await git(root, ["log", "--all", `--format=${LOG_FORMAT}`, "-n", "200"])).stdout);
  const sha = await quickPick([...commits.map((c) => ({ label: c.subject, description: `${c.short} · ${c.when}`, value: c.sha })), { label: "Enter a SHA…", value: "" }], { title: "Which branches and tags contain…" });
  if (sha === undefined) return;
  const target = sha || (await inputBox({ title: "Commit SHA" }));
  if (!target) return;
  const br = (await git(root, ["branch", "-a", "--format=%(refname:short)", "--contains", target])).stdout.split("\n").filter(Boolean);
  const tags = (await git(root, ["tag", "--contains", target, "--sort=creatordate"])).stdout.split("\n").filter(Boolean);
  await quickPick(
    [...tags.slice(0, 1).map((t) => ({ label: `🏷 First released in ${t}`, value: t })), ...br.map((b) => ({ label: `⎇ ${b}`, value: b })), ...tags.map((t) => ({ label: `🏷 ${t}`, value: t }))],
    { title: `${br.length} branch(es), ${tags.length} tag(s) contain ${target.slice(0, 8)}`, emptyText: "Not on any branch or tag" },
  );
}

export async function incomingOutgoing(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const t = toast.loading("Fetching…");
  await git(root, ["fetch", "--quiet"], 60);
  toast.dismiss(t);
  const out = parseLog((await git(root, ["log", `--format=${LOG_FORMAT}`, "@{upstream}..HEAD"])).stdout);
  const inc = parseLog((await git(root, ["log", `--format=${LOG_FORMAT}`, "HEAD..@{upstream}"])).stdout);
  const pick = await quickPick(
    [...out.map((c) => ({ label: `⬆ ${c.subject}`, description: `${c.short} · ${c.author} · ${c.when}`, value: c.sha })), ...inc.map((c) => ({ label: `⬇ ${c.subject}`, description: `${c.short} · ${c.author} · ${c.when}`, value: c.sha }))],
    { title: `${out.length} to push · ${inc.length} to pull`, emptyText: "Up to date with upstream" },
  );
  if (pick) openTextViewer(pick.slice(0, 8), (await git(root, ["show", "--stat", "--patch", pick])).stdout, "diff");
}

export const GIT_EXTRA_ACTIONS_4 = [
  { id: "git.stageLines", label: "Git: Stage selected lines", keywords: ["stage", "partial", "hunk", "lines", "add -p", "selection"], run: () => applyPartial("stage") },
  { id: "git.unstageLines", label: "Git: Unstage selected lines", keywords: ["unstage", "partial", "hunk", "lines", "reset -p"], run: () => applyPartial("unstage") },
  { id: "git.discardLines", label: "Git: Discard changes in selected lines…", keywords: ["discard", "revert lines", "partial", "hunk", "checkout -p"], run: () => applyPartial("discard") },
  { id: "git.rebasePlanner", label: "Git: Interactive rebase (drag to reorder, squash, reword)…", keywords: ["rebase", "interactive", "squash", "fixup", "reorder", "drop", "autosquash"], run: openRebaseEditor },
  { id: "git.splitCommit", label: "Git: Split last commit (one commit per file)…", keywords: ["split", "commit", "per file", "break up", "atomic"], run: splitLastCommit },
  { id: "git.staleBranches", label: "Git: Stale branches…", keywords: ["stale", "old", "branches", "cleanup", "merged", "gone"], run: staleBranches },
  { id: "git.largeBlobs", label: "Git: Largest files in history", keywords: ["large", "blobs", "size", "bloat", "lfs", "history", "big files"], run: largeBlobs },
  { id: "git.coAuthor", label: "Git: Add co-author to last commit…", keywords: ["co-author", "pair", "trailer", "co-authored-by", "mob"], run: addCoAuthor },
  { id: "git.oldestTodos", label: "Git: Oldest TODOs (dated by blame)", keywords: ["todo", "fixme", "age", "blame", "tech debt", "oldest"], run: oldestTodos },
  { id: "git.clean", label: "Git: Clean untracked files (preview first)…", keywords: ["clean", "untracked", "ignored", "remove", "reset", "scrub"], run: cleanUntracked },
  { id: "git.cherryPickRange", label: "Git: Cherry-pick a range of commits…", keywords: ["cherry-pick", "range", "backport", "port", "commits"], run: cherryPickRange },
  { id: "git.contains", label: "Git: Which branches / tags contain a commit…", keywords: ["contains", "released", "tag", "branch", "shipped", "which version"], run: refsContaining },
  { id: "git.incomingOutgoing", label: "Git: Incoming / outgoing commits", keywords: ["ahead", "behind", "incoming", "outgoing", "unpushed", "upstream"], run: incomingOutgoing },
];
