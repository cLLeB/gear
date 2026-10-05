import { describe, expect, it } from "vitest";
import {
  appendGitignore,
  gitignorePatternFor,
  nextVersionTags,
  parseBisectOutput,
  parseLog,
  parseStashList,
  parseTags,
  parseWorktrees,
  SEP,
  worktreePathFor,
} from "./extras";

describe("parseStashList", () => {
  it("splits refs, branch and message", () => {
    const out = [`stash@{0}${SEP}On main: try thing${SEP}2 hours ago`, `stash@{1}${SEP}WIP on feat/x: abc123 msg${SEP}3 days ago`].join("\n");
    expect(parseStashList(out)).toEqual([
      { ref: "stash@{0}", index: 0, message: "try thing", branch: "main", when: "2 hours ago" },
      { ref: "stash@{1}", index: 1, message: "abc123 msg", branch: "feat/x", when: "3 days ago" },
    ]);
  });
});

describe("parseWorktrees", () => {
  it("reads porcelain blocks", () => {
    const out = "worktree /src/app\nHEAD aaa\nbranch refs/heads/main\n\nworktree /src/app-fix\nHEAD bbb\ndetached\nlocked reason\n\n";
    const wts = parseWorktrees(out);
    expect(wts).toHaveLength(2);
    expect(wts[0]).toMatchObject({ path: "/src/app", branch: "main", main: true });
    expect(wts[1]).toMatchObject({ path: "/src/app-fix", detached: true, locked: true, main: false });
  });

  it("names sibling directories", () => {
    expect(worktreePathFor("/src/app/", "feat/login page")).toBe("/src/app-feat-login-page");
    expect(worktreePathFor("C:\\code\\app", "fix")).toBe("C:\\code\\app-fix");
  });
});

describe("log and tags", () => {
  it("parses log lines", () => {
    expect(parseLog(`abc${SEP}ab${SEP}Fix it${SEP}Ann${SEP}1 day ago\n`)).toEqual([
      { sha: "abc", short: "ab", subject: "Fix it", author: "Ann", when: "1 day ago" },
    ]);
  });

  it("parses tags and proposes the next versions", () => {
    expect(parseTags(`v1.2.3${SEP}abc${SEP}Release${SEP}2 weeks ago`)[0].name).toBe("v1.2.3");
    expect(nextVersionTags(["v1.2.3", "v1.10.0", "junk"])).toEqual(["v1.10.1", "v1.11.0", "v2.0.0"]);
    expect(nextVersionTags(["0.3.9"])).toEqual(["0.3.10", "0.4.0", "1.0.0"]);
    expect(nextVersionTags([])).toEqual(["v0.1.0", "v1.0.0"]);
  });
});

describe("parseBisectOutput", () => {
  it("reads progress and the culprit", () => {
    expect(parseBisectOutput("Bisecting: 12 revisions left to test after this (roughly 4 steps)\n[deadbeef] Some commit")).toEqual({
      remaining: 12,
      steps: 4,
      current: "deadbeef",
      done: null,
    });
    expect(parseBisectOutput("abc1234def is the first bad commit\ncommit abc1234def").done).toBe("abc1234def");
  });
});

describe("gitignore helpers", () => {
  it("builds patterns", () => {
    expect(gitignorePatternFor("logs/app.log", "file")).toBe("/logs/app.log");
    expect(gitignorePatternFor("logs/app.log", "extension")).toBe("*.log");
    expect(gitignorePatternFor("logs/app.log", "folder")).toBe("/logs/");
  });

  it("appends once", () => {
    expect(appendGitignore("node_modules", "*.log")).toBe("node_modules\n*.log\n");
    expect(appendGitignore("*.log\n", "*.log")).toBeNull();
    expect(appendGitignore("logs/app.log\n", "/logs/app.log")).toBeNull();
    expect(appendGitignore("", "/x")).toBe("/x\n");
  });
});
