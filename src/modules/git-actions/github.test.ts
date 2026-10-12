import { describe, expect, it } from "vitest";
import {
  checkState,
  checksText,
  cleanRunLog,
  ghProblem,
  orderRuns,
  parseIssues,
  parsePullRequests,
  parseRuns,
  reviewText,
  runState,
  summarizeChecks,
} from "./github";

describe("summarizeChecks", () => {
  it("counts check runs and commit statuses together", () => {
    const rollup = [
      { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" },
      { __typename: "CheckRun", status: "COMPLETED", conclusion: "SKIPPED" },
      { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" },
      { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: "" },
      { __typename: "CheckRun", status: "QUEUED", conclusion: null },
      { __typename: "StatusContext", state: "SUCCESS" },
      { __typename: "StatusContext", state: "PENDING" },
      { __typename: "StatusContext", state: "ERROR" },
    ];
    expect(summarizeChecks(rollup)).toEqual({ pass: 3, fail: 2, pending: 3 });
  });

  it("treats a missing rollup as no checks", () => {
    expect(summarizeChecks(null)).toEqual({ pass: 0, fail: 0, pending: 0 });
    expect(checkState(summarizeChecks(undefined))).toBe("none");
    expect(checksText({ pass: 0, fail: 0, pending: 0 })).toBe("no checks");
  });

  it("a failure outranks running checks, which outrank passes", () => {
    expect(checkState({ pass: 4, fail: 1, pending: 2 })).toBe("fail");
    expect(checkState({ pass: 4, fail: 0, pending: 2 })).toBe("pending");
    expect(checkState({ pass: 4, fail: 0, pending: 0 })).toBe("pass");
    expect(checksText({ pass: 4, fail: 1, pending: 2 })).toBe("1 failing, 2 running, 4 passed");
  });
});

describe("parsePullRequests", () => {
  it("reads gh pr list --json output", () => {
    const json = JSON.stringify([
      {
        number: 27,
        title: "feat: backdrop",
        author: { login: "cLLeB", is_bot: false },
        headRefName: "feature/x",
        isDraft: true,
        updatedAt: "2026-10-11T15:00:21Z",
        url: "https://github.com/o/r/pull/27",
        reviewDecision: "CHANGES_REQUESTED",
        statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
      },
      { number: 5, title: "bot", author: null, headRefName: "dep", isDraft: false, statusCheckRollup: null },
    ]);
    const prs = parsePullRequests(json);
    expect(prs).toHaveLength(2);
    expect(prs?.[0]).toMatchObject({ number: 27, author: "cLLeB", branch: "feature/x", draft: true, review: "CHANGES_REQUESTED", checks: { pass: 1, fail: 0, pending: 0 } });
    expect(prs?.[1]).toMatchObject({ number: 5, author: "", url: "", review: "" });
    expect(reviewText("CHANGES_REQUESTED")).toBe("changes requested");
    expect(reviewText("")).toBe("");
  });

  it("returns null for output that is not a JSON array (truncated, or an error page)", () => {
    expect(parsePullRequests('[{"number": 1')).toBeNull();
    expect(parsePullRequests('{"message":"Not Found"}')).toBeNull();
    expect(parsePullRequests("")).toBeNull();
  });
});

describe("workflow runs", () => {
  const json = JSON.stringify([
    { databaseId: 3, displayTitle: "c", workflowName: "CI", headBranch: "main", event: "push", status: "completed", conclusion: "success", createdAt: "t3", url: "u3" },
    { databaseId: 2, displayTitle: "b", workflowName: "CI", headBranch: "feat", event: "pull_request", status: "in_progress", conclusion: "", createdAt: "t2", url: "u2" },
    { databaseId: 1, displayTitle: "a", workflowName: "Release", headBranch: "feat", event: "push", status: "completed", conclusion: "failure", createdAt: "t1", url: "u1" },
  ]);

  it("parses runs and reads their state", () => {
    const runs = parseRuns(json);
    expect(runs?.map((r) => r.id)).toEqual([3, 2, 1]);
    expect(runs?.map(runState)).toEqual(["pass", "pending", "fail"]);
    expect(runState({ status: "completed", conclusion: "" })).toBe("none");
    expect(runState({ status: "completed", conclusion: "cancelled" })).toBe("fail");
  });

  it("puts the current branch's runs first without reordering within a group", () => {
    const runs = parseRuns(json) ?? [];
    expect(orderRuns(runs, "feat").map((r) => r.id)).toEqual([2, 1, 3]);
    expect(orderRuns(runs, null).map((r) => r.id)).toEqual([3, 2, 1]);
    expect(orderRuns(runs, "elsewhere").map((r) => r.id)).toEqual([3, 2, 1]);
  });
});

describe("parseIssues", () => {
  it("reads labels and tolerates missing fields", () => {
    const issues = parseIssues(JSON.stringify([{ number: 9, title: "Crash", author: { login: "a" }, labels: [{ name: "bug" }, { name: "p1" }], updatedAt: "t", url: "u" }, { number: 10, title: "x" }]));
    expect(issues?.[0]).toEqual({ number: 9, title: "Crash", author: "a", labels: ["bug", "p1"], updatedAt: "t", url: "u" });
    expect(issues?.[1].labels).toEqual([]);
  });
});

describe("cleanRunLog", () => {
  it("groups by job and step and strips timestamps, colour and runner markers", () => {
    const log = [
      "rust\tClippy\t﻿2026-10-11T15:01:02.1234567Z ##[group]Run cargo clippy",
      "rust\tClippy\t2026-10-11T15:01:02.2000000Z \x1b[36;1mcargo clippy -- -D warnings\x1b[0m",
      "rust\tClippy\t2026-10-11T15:01:02.3000000Z ##[endgroup]",
      "rust\tClippy\t2026-10-11T15:01:09.0000000Z error: unused variable\twith a tab",
      "rust\tClippy\t2026-10-11T15:01:09.1000000Z ##[error]Process completed with exit code 101.",
      "frontend\tTests\t2026-10-11T15:02:00.0000000Z FAIL src/a.test.ts",
    ].join("\r\n");
    expect(cleanRunLog(log)).toBe(
      ["── rust › Clippy ──", "cargo clippy -- -D warnings", "error: unused variable\twith a tab", "ERROR: Process completed with exit code 101.", "", "── frontend › Tests ──", "FAIL src/a.test.ts"].join("\n"),
    );
  });

  it("strips colour codes that gh printed in caret notation", () => {
    expect(cleanRunLog('a\tb\t2026-10-11T15:01:09.0Z ^[[31;1mProgram "komac.exe" ended^[[0m')).toBe('── a › b ──\nProgram "komac.exe" ended');
  });

  it("leaves plain text alone", () => {
    expect(cleanRunLog("just a line\nand another")).toBe("just a line\nand another");
  });
});

describe("ghProblem", () => {
  it("tells a missing CLI, a missing login and a non-GitHub repo apart", () => {
    expect(ghProblem(127, "bash: gh: command not found")).toBe("missing");
    expect(ghProblem(1, "gh : The term 'gh' is not recognized as the name of a cmdlet")).toBe("missing");
    expect(ghProblem(4, "To get started with GitHub CLI, please run:  gh auth login")).toBe("auth");
    expect(ghProblem(1, "HTTP 401: Bad credentials")).toBe("auth");
    expect(ghProblem(1, "none of the git remotes configured for this repository point to a known GitHub host")).toBe("no-remote");
    expect(ghProblem(1, "HTTP 502")).toBe("other");
  });
});
