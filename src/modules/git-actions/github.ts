// Pure helpers for the GitHub palette commands, which drive the `gh` CLI:
// parsing its --json output, summarising checks, and trimming run logs.

export interface PullRequest {
  number: number;
  title: string;
  author: string;
  branch: string;
  draft: boolean;
  updatedAt: string;
  url: string;
  review: string;
  checks: CheckSummary;
}

export interface CheckSummary {
  pass: number;
  fail: number;
  pending: number;
}

export type CheckState = "pass" | "fail" | "pending" | "none";

export interface WorkflowRun {
  id: number;
  title: string;
  workflow: string;
  branch: string;
  event: string;
  status: string;
  conclusion: string;
  createdAt: string;
  url: string;
}

export interface Issue {
  number: number;
  title: string;
  author: string;
  labels: string[];
  updatedAt: string;
  url: string;
}

export const PR_FIELDS = "number,title,author,headRefName,isDraft,updatedAt,url,reviewDecision,statusCheckRollup";
export const RUN_FIELDS = "databaseId,displayTitle,workflowName,headBranch,event,status,conclusion,createdAt,url";
export const ISSUE_FIELDS = "number,title,author,labels,updatedAt,url";

type Json = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : 0);

function rows(json: string): Json[] | null {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((r): r is Json => typeof r === "object" && r !== null) : null;
  } catch {
    return null;
  }
}

const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
const PASSED = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

/** Counts a PR's `statusCheckRollup`, which mixes check runs and commit statuses. */
export function summarizeChecks(rollup: unknown): CheckSummary {
  const out: CheckSummary = { pass: 0, fail: 0, pending: 0 };
  if (!Array.isArray(rollup)) return out;
  for (const c of rollup as Json[]) {
    // Check runs carry status + conclusion; commit statuses carry state only.
    const result = (str(c.conclusion) || str(c.state)).toUpperCase();
    const status = str(c.status).toUpperCase();
    if (status && status !== "COMPLETED") out.pending++;
    else if (FAILED.has(result)) out.fail++;
    else if (PASSED.has(result)) out.pass++;
    else out.pending++;
  }
  return out;
}

export function checkState(c: CheckSummary): CheckState {
  if (c.fail) return "fail";
  if (c.pending) return "pending";
  return c.pass ? "pass" : "none";
}

export const CHECK_ICON: Record<CheckState, string> = { pass: "✓", fail: "✗", pending: "●", none: "–" };

export function checksText(c: CheckSummary): string {
  const parts = [c.fail && `${c.fail} failing`, c.pending && `${c.pending} running`, c.pass && `${c.pass} passed`].filter(Boolean);
  return parts.length ? parts.join(", ") : "no checks";
}

export function parsePullRequests(json: string): PullRequest[] | null {
  return (
    rows(json)?.map((r) => ({
      number: num(r.number),
      title: str(r.title),
      author: str((r.author as Json | null)?.login),
      branch: str(r.headRefName),
      draft: r.isDraft === true,
      updatedAt: str(r.updatedAt),
      url: str(r.url),
      review: str(r.reviewDecision),
      checks: summarizeChecks(r.statusCheckRollup),
    })) ?? null
  );
}

export function reviewText(decision: string): string {
  if (decision === "APPROVED") return "approved";
  if (decision === "CHANGES_REQUESTED") return "changes requested";
  if (decision === "REVIEW_REQUIRED") return "review required";
  return "";
}

export function parseRuns(json: string): WorkflowRun[] | null {
  return (
    rows(json)?.map((r) => ({
      id: num(r.databaseId),
      title: str(r.displayTitle),
      workflow: str(r.workflowName),
      branch: str(r.headBranch),
      event: str(r.event),
      status: str(r.status),
      conclusion: str(r.conclusion),
      createdAt: str(r.createdAt),
      url: str(r.url),
    })) ?? null
  );
}

export function runState(run: Pick<WorkflowRun, "status" | "conclusion">): CheckState {
  if (run.status.toUpperCase() !== "COMPLETED") return "pending";
  const c = run.conclusion.toUpperCase();
  if (PASSED.has(c)) return "pass";
  return FAILED.has(c) ? "fail" : "none";
}

/** Runs for `branch` first, each group newest first as gh returned them. */
export function orderRuns(runs: readonly WorkflowRun[], branch: string | null): WorkflowRun[] {
  if (!branch) return [...runs];
  return [...runs.filter((r) => r.branch === branch), ...runs.filter((r) => r.branch !== branch)];
}

export function parseIssues(json: string): Issue[] | null {
  return (
    rows(json)?.map((r) => ({
      number: num(r.number),
      title: str(r.title),
      author: str((r.author as Json | null)?.login),
      labels: Array.isArray(r.labels) ? (r.labels as Json[]).map((l) => str(l.name)).filter(Boolean) : [],
      updatedAt: str(r.updatedAt),
      url: str(r.url),
    })) ?? null
  );
}

// gh prints the escape character as a literal ^[ when its output is piped.
const ANSI = /(?:\x1b|\^\[)\[[0-9;?]*[ -/]*[@-~]/g;
const LOG_TIME = /^\uFEFF?\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/;

/**
 * `gh run view --log-failed` prefixes every line with "job<TAB>step<TAB>time".
 * Returns the text under one heading per job / step, without colour codes,
 * timestamps or the runner's ##[group] noise.
 */
export function cleanRunLog(log: string): string {
  const out: string[] = [];
  let heading = "";
  for (const raw of log.replace(/\r\n?/g, "\n").split("\n")) {
    const cols = raw.split("\t");
    let text = raw;
    if (cols.length >= 3) {
      const next = `${cols[0]} › ${cols[1]}`;
      if (next !== heading) {
        heading = next;
        if (out.length) out.push("");
        out.push(`── ${heading} ──`);
      }
      text = cols.slice(2).join("\t");
    }
    text = text.replace(LOG_TIME, "").replace(ANSI, "");
    if (/^##\[(?:end)?group\]/.test(text) || text.startsWith("##[end-action")) continue;
    out.push(text.replace(/^##\[error\]/, "ERROR: ").replace(/^##\[warning\]/, "WARNING: "));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export type GhProblem = "missing" | "auth" | "no-remote" | "other";

/** Why a gh call failed, so the message can say what to do about it. */
export function ghProblem(exitCode: number | null, stderr: string): GhProblem {
  const s = stderr.toLowerCase();
  if (exitCode === 127 || exitCode === 9009 || /not recognized|command not found|not found: gh|no such file/.test(s)) return "missing";
  if (/gh auth login|not logged in|authentication|http 401|bad credentials/.test(s)) return "auth";
  if (/no git remotes|none of the git remotes|not a git repository|could not resolve to a repository/.test(s)) return "no-remote";
  return "other";
}

export const GH_PROBLEM_TEXT: Record<Exclude<GhProblem, "other">, { title: string; description: string }> = {
  missing: { title: "GitHub CLI (gh) is not installed", description: "Install it from cli.github.com, then run `gh auth login`." },
  auth: { title: "GitHub CLI is not signed in", description: "Run `gh auth login` in a terminal." },
  "no-remote": { title: "This repository has no GitHub remote", description: "gh found no github.com remote to query." },
};
