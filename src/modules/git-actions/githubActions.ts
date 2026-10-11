// GitHub from the palette, through the user's own `gh` CLI and login: pull
// requests (check out, diff, checks, merge), workflow runs (failed log, re-run,
// watch, cancel) and issues.

import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { openExternalUrl } from "@/lib/external-link";
import { quoteShellArg } from "@/lib/shellQuote";
import { compactRelativeTime } from "@/lib/toolkit/compactRelativeTime";
import { native } from "@/modules/ai/lib/native";
import { openTextViewer } from "@/modules/compare/CompareDialog";
import { inputBox, quickPick } from "@/modules/quick-pick";
import { git, requireRepo } from "./gitCli";
import {
  CHECK_ICON,
  checkState,
  checksText,
  cleanRunLog,
  GH_PROBLEM_TEXT,
  ghProblem,
  ISSUE_FIELDS,
  orderRuns,
  parseIssues,
  parsePullRequests,
  parseRuns,
  PR_FIELDS,
  type PullRequest,
  reviewText,
  RUN_FIELDS,
  runState,
  type WorkflowRun,
} from "./github";

async function gh(root: string, args: string[], what: string, timeoutSecs = 45): Promise<string | null> {
  const cmd = ["gh", ...args.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : quoteShellArg(a)))].join(" ");
  const out = await native.runCommand(cmd, root, timeoutSecs);
  if (out.exit_code === 0) return out.stdout;
  const problem = ghProblem(out.exit_code, out.stderr);
  if (problem === "other") toast.error(`${what} failed`, { description: (out.stderr || out.stdout).trim().slice(0, 400) });
  else toast.error(GH_PROBLEM_TEXT[problem].title, { description: GH_PROBLEM_TEXT[problem].description });
  return null;
}

const ago = (iso: string): string => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : compactRelativeTime(t);
};

const copy = (text: string, what: string) =>
  navigator.clipboard.writeText(text).then(
    () => void toast.success(`${what} copied`),
    () => void toast.error("Could not copy to the clipboard"),
  );

async function showRunLog(root: string, run: WorkflowRun, failedOnly: boolean): Promise<void> {
  const t = toast.loading("Fetching the log…");
  const log = await gh(root, ["run", "view", String(run.id), failedOnly ? "--log-failed" : "--log"], "Fetching the log", 90);
  toast.dismiss(t);
  if (log === null) return;
  const text = cleanRunLog(log);
  if (!text) return void toast.info(failedOnly ? "No failed steps in this run" : "This run has no log yet");
  openTextViewer(`${run.workflow} · ${run.title}`.slice(0, 80), text, "log");
}

async function runMenu(root: string, run: WorkflowRun): Promise<void> {
  const state = runState(run);
  const id = String(run.id);
  const action = await quickPick(
    [
      ...(state === "fail" ? [{ label: "Show the failed steps' log", value: "failed" }] : []),
      ...(state !== "pending" ? [{ label: "Show the full log", value: "log" }] : []),
      ...(state === "pending" ? [{ label: "Watch in a terminal", value: "watch" }, { label: "Cancel the run", value: "cancel" }] : []),
      ...(state === "fail" ? [{ label: "Re-run failed jobs", value: "rerun-failed" }] : []),
      ...(state !== "pending" ? [{ label: "Re-run all jobs", value: "rerun" }] : []),
      { label: "Open on GitHub", value: "web" },
      { label: "Copy link", value: "copy" },
    ],
    { title: `${CHECK_ICON[state]} ${run.workflow} · ${run.title}` },
  );
  if (action === "failed") await showRunLog(root, run, true);
  else if (action === "log") await showRunLog(root, run, false);
  else if (action === "watch") app().openTerminal({ cwd: root, command: `gh run watch ${id}` });
  else if (action === "cancel") {
    if ((await gh(root, ["run", "cancel", id], "Cancelling the run")) !== null) toast.success("Cancellation requested");
  } else if (action === "rerun-failed" || action === "rerun") {
    const args = ["run", "rerun", id, ...(action === "rerun-failed" ? ["--failed"] : [])];
    if ((await gh(root, args, "Re-running")) !== null) toast.success("Re-run started");
  } else if (action === "web") await openExternalUrl(run.url);
  else if (action === "copy") await copy(run.url, "Link");
}

export async function workflowRuns(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const branch = (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim() || null;
  const run = await quickPick(
    (async () => {
      const out = await gh(root, ["run", "list", "--limit", "40", "--json", RUN_FIELDS], "Listing workflow runs");
      const runs = out === null ? null : parseRuns(out);
      if (!runs) throw new Error("Could not read the workflow runs");
      return orderRuns(runs, branch).map((r) => ({
        label: `${CHECK_ICON[runState(r)]} ${r.title}`,
        description: [r.workflow, r.event, ago(r.createdAt)].filter(Boolean).join(" · "),
        keywords: [r.workflow, r.branch, r.conclusion || r.status],
        group: r.branch === branch ? `This branch (${r.branch})` : "Other branches",
        detail: r.branch === branch ? undefined : r.branch,
        value: r,
      }));
    })(),
    { title: "Workflow runs", emptyText: "No workflow runs" },
  );
  if (run) await runMenu(root, run);
}

async function showChecks(root: string, pr: PullRequest): Promise<void> {
  const out = await gh(root, ["pr", "checks", String(pr.number), "--json", "name,workflow,bucket,link,description"], "Listing checks");
  if (out === null) return;
  let checks: Array<{ name?: string; workflow?: string; bucket?: string; link?: string; description?: string }>;
  try {
    checks = JSON.parse(out);
  } catch {
    return void toast.error("Could not read the checks");
  }
  const icon = (bucket?: string) => (bucket === "pass" || bucket === "skipping" ? "✓" : bucket === "fail" || bucket === "cancel" ? "✗" : "●");
  const link = await quickPick(
    checks.map((c) => ({ label: `${icon(c.bucket)} ${c.name ?? ""}`, description: [c.workflow, c.description].filter(Boolean).join(" · "), value: c.link ?? "" })),
    { title: `#${pr.number} · ${checksText(pr.checks)}`, emptyText: "No checks on this pull request" },
  );
  if (link) await openExternalUrl(link);
}

async function prMenu(root: string, pr: PullRequest): Promise<void> {
  const n = String(pr.number);
  const action = await quickPick(
    [
      { label: "Check out this branch", description: pr.branch, value: "checkout" },
      { label: "Show the diff", value: "diff" },
      { label: "Show checks", description: checksText(pr.checks), value: "checks" },
      { label: "Merge… (in a terminal)", value: "merge" },
      ...(pr.draft ? [{ label: "Mark as ready for review", value: "ready" }] : []),
      { label: "Add a comment…", value: "comment" },
      { label: "Open on GitHub", value: "web" },
      { label: "Copy link", value: "copy" },
    ],
    { title: `#${pr.number} ${pr.title}` },
  );
  if (action === "checkout") {
    if ((await gh(root, ["pr", "checkout", n], "Checking out", 120)) !== null) toast.success(`Checked out ${pr.branch}`);
  } else if (action === "diff") {
    const diff = await gh(root, ["pr", "diff", n], "Fetching the diff", 90);
    if (diff !== null) openTextViewer(`#${pr.number} ${pr.title}`.slice(0, 80), diff, "diff");
  } else if (action === "checks") await showChecks(root, pr);
  else if (action === "merge") app().openTerminal({ cwd: root, command: `gh pr merge ${n}` });
  else if (action === "ready") {
    if ((await gh(root, ["pr", "ready", n], "Marking as ready")) !== null) toast.success(`#${pr.number} is ready for review`);
  } else if (action === "comment") {
    const body = await inputBox({ title: `Comment on #${pr.number}`, placeholder: "Markdown is supported" });
    if (body?.trim() && (await gh(root, ["pr", "comment", n, "--body", body], "Commenting")) !== null) toast.success("Comment added");
  } else if (action === "web") await openExternalUrl(pr.url);
  else if (action === "copy") await copy(pr.url, "Link");
}

export async function pullRequests(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const pr = await quickPick(
    (async () => {
      const out = await gh(root, ["pr", "list", "--limit", "30", "--json", PR_FIELDS], "Listing pull requests");
      const prs = out === null ? null : parsePullRequests(out);
      if (!prs) throw new Error("Could not read the pull requests");
      return prs.map((p) => ({
        label: `${CHECK_ICON[checkState(p.checks)]} #${p.number} ${p.title}`,
        description: [p.draft && "draft", reviewText(p.review), p.author, ago(p.updatedAt)].filter(Boolean).join(" · "),
        detail: p.branch,
        keywords: [p.branch, p.author],
        value: p,
      }));
    })(),
    { title: "Pull requests", emptyText: "No open pull requests" },
  );
  if (pr) await prMenu(root, pr);
}

/** Jumps straight to the pull request of the checked-out branch. */
export async function currentPullRequest(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const out = await native.runCommand(`gh pr view --json ${PR_FIELDS}`, root, 45);
  if (out.exit_code !== 0) {
    const problem = ghProblem(out.exit_code, out.stderr);
    if (/no pull requests found/i.test(out.stderr)) {
      const create = await quickPick(
        [{ label: "Create a pull request (in a terminal)", value: "create" }, { label: "Create on GitHub", value: "web" }],
        { title: "This branch has no pull request" },
      );
      if (create) app().openTerminal({ cwd: root, command: create === "web" ? "gh pr create --web" : "gh pr create" });
    } else if (problem === "other") toast.error("Looking up the pull request failed", { description: out.stderr.trim().slice(0, 400) });
    else toast.error(GH_PROBLEM_TEXT[problem].title, { description: GH_PROBLEM_TEXT[problem].description });
    return;
  }
  const pr = parsePullRequests(`[${out.stdout}]`)?.[0];
  if (pr) await prMenu(root, pr);
}

export async function issues(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const issue = await quickPick(
    (async () => {
      const out = await gh(root, ["issue", "list", "--limit", "50", "--json", ISSUE_FIELDS], "Listing issues");
      const list = out === null ? null : parseIssues(out);
      if (!list) throw new Error("Could not read the issues");
      return list.map((i) => ({
        label: `#${i.number} ${i.title}`,
        description: [i.labels.join(", "), i.author, ago(i.updatedAt)].filter(Boolean).join(" · "),
        keywords: i.labels,
        value: i,
      }));
    })(),
    { title: "Issues", emptyText: "No open issues" },
  );
  if (!issue) return;
  const n = String(issue.number);
  const action = await quickPick(
    [
      { label: "Read the issue", value: "read" },
      { label: "Start a branch for it", description: "gh issue develop --checkout", value: "develop" },
      { label: "Add a comment…", value: "comment" },
      { label: "Open on GitHub", value: "web" },
      { label: "Copy link", value: "copy" },
    ],
    { title: `#${issue.number} ${issue.title}` },
  );
  if (action === "read") {
    const body = await gh(root, ["issue", "view", n, "--comments"], "Reading the issue");
    if (body !== null) openTextViewer(`#${issue.number} ${issue.title}`.slice(0, 80), body, "markdown");
  } else if (action === "develop") {
    if ((await gh(root, ["issue", "develop", n, "--checkout"], "Creating the branch", 90)) !== null) toast.success(`On a new branch for #${issue.number}`);
  } else if (action === "comment") {
    const body = await inputBox({ title: `Comment on #${issue.number}`, placeholder: "Markdown is supported" });
    if (body?.trim() && (await gh(root, ["issue", "comment", n, "--body", body], "Commenting")) !== null) toast.success("Comment added");
  } else if (action === "web") await openExternalUrl(issue.url);
  else if (action === "copy") await copy(issue.url, "Link");
}

export const GITHUB_ACTIONS = [
  { id: "github.pullRequests", label: "GitHub: Pull requests…", keywords: ["pr", "pull request", "review", "checkout", "merge", "gh"], run: pullRequests },
  { id: "github.currentPullRequest", label: "GitHub: Pull request for this branch…", keywords: ["pr", "pull request", "create", "checks", "branch", "gh"], run: currentPullRequest },
  { id: "github.workflowRuns", label: "GitHub: Workflow runs (CI)…", keywords: ["ci", "actions", "checks", "build", "failed", "log", "rerun", "pipeline", "gh"], run: workflowRuns },
  { id: "github.issues", label: "GitHub: Issues…", keywords: ["issue", "bug", "ticket", "develop", "gh"], run: issues },
];
