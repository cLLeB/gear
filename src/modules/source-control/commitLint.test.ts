import { describe, expect, it } from "vitest";
import { lintCommitMessage } from "./commitLint";

const msgs = (m: string, o = {}) => lintCommitMessage(m, o).map((i) => i.message);

describe("lintCommitMessage", () => {
  it("accepts a good conventional message", () => {
    expect(lintCommitMessage("feat(editor): add rulers\n\nExplain why.")).toEqual([]);
    expect(lintCommitMessage("fix!: drop node 16")).toEqual([]);
  });

  it("flags format problems", () => {
    expect(msgs("Add rulers")[0]).toMatch(/type\(scope\): subject/);
    expect(msgs("feature: add x")).toContain('Unknown type "feature" (expected feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert)');
    expect(msgs("fix(): add x")).toContain("The scope in parentheses is empty");
  });

  it("flags hygiene problems", () => {
    const issues = msgs("fix: Added the thing.\nno blank line");
    expect(issues).toContain("Start the subject in lower case");
    expect(issues).toContain("Drop the trailing period from the subject");
    expect(issues).toContain("Leave a blank line between the subject and the body");
    expect(msgs("fix: added the thing")).toContain('Use the imperative mood ("add…", not "added…")');
    expect(msgs(`fix: ${"x".repeat(80)}`)[0]).toMatch(/keep it within 72/);
  });

  it("skips fixup/merge/revert messages and comment lines", () => {
    expect(lintCommitMessage("fixup! feat: x")).toEqual([]);
    expect(lintCommitMessage("Merge branch 'main' into x")).toEqual([]);
    expect(lintCommitMessage("# comment\nfeat: ok")).toEqual([]);
  });

  it("supports non-conventional repos", () => {
    expect(msgs("add rulers", { conventional: false })).toContain("Capitalise the subject line");
    expect(lintCommitMessage("Add rulers", { conventional: false })).toEqual([]);
  });
});
