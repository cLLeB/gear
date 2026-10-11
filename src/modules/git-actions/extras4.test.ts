import { describe, expect, it } from "vitest";
import {
  addTrailer,
  autosquashPlan,
  blameTimes,
  filterPatch,
  humanSize,
  largestBlobs,
  parseBranches,
  parseCleanDryRun,
  parseGitGrep,
  parseShortlog,
  rebaseTodo,
  splitCommitScript,
  staleness,
} from "./extras4";

const diff = [
  "diff --git a/f.txt b/f.txt",
  "index 1111111..2222222 100644",
  "--- a/f.txt",
  "+++ b/f.txt",
  "@@ -1,6 +1,7 @@",
  " one",
  "-two",
  "+TWO",
  " three",
  "+three-and-a-half",
  " four",
  "-five",
  "+FIVE",
  " six",
  "",
].join("\n");

describe("filterPatch", () => {
  it("keeps only changes in the selected new-file lines", () => {
    // New file: 1 one, 2 TWO, 3 three, 4 three-and-a-half, 5 four, 6 FIVE, 7 six
    expect(filterPatch(diff, 4, 4)).toBe(
      ["diff --git a/f.txt b/f.txt", "index 1111111..2222222 100644", "--- a/f.txt", "+++ b/f.txt", "@@ -1,6 +1,7 @@", " one", " two", " three", "+three-and-a-half", " four", " five", " six", ""].join("\n"),
    );
    const p = filterPatch(diff, 2, 2)!;
    expect(p).toContain("-two\n+TWO\n three\n four\n five\n six");
    expect(p).toContain("@@ -1,6 +1,6 @@");
    expect(filterPatch(diff, 7, 7)).toBeNull();
  });

  it("handles multiple hunks", () => {
    const two = "--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-a\n+A\n b\n@@ -10,2 +10,3 @@\n c\n+D\n e\n";
    const p = filterPatch(two, 11, 11)!;
    expect(p).toBe("--- a/x\n+++ b/x\n@@ -10,2 +10,3 @@\n c\n+D\n e\n");
  });
});

describe("rebase", () => {
  it("builds todos and autosquash plans", () => {
    const commits = [
      { sha: "a1", subject: "feat: x" },
      { sha: "b2", subject: "feat: y" },
      { sha: "c3", subject: "fixup! feat: x" },
      { sha: "d4", subject: "squash! feat: y" },
    ];
    const plan = autosquashPlan(commits);
    expect(plan.map((p) => `${p.action} ${p.sha}`)).toEqual(["pick a1", "fixup c3", "pick b2", "squash d4"]);
    expect(rebaseTodo(plan)).toBe("pick a1 feat: x\nfixup c3 fixup! feat: x\npick b2 feat: y\nsquash d4 squash! feat: y\n");
    expect(() => rebaseTodo([{ sha: "a", subject: "x", action: "fixup" }])).toThrow();
  });

  it("splits a commit per file", () => {
    expect(splitCommitScript("feat: it's", ["src/a.ts", "b.md"], "posix")).toBe(
      "git reset --soft HEAD~1 && git reset -q && git add -A -- 'src/a.ts' && git commit -q -m 'feat: it'\\''s (a.ts)' && git add -A -- 'b.md' && git commit -q -m 'feat: it'\\''s (b.md)'",
    );
    expect(splitCommitScript("x", ["a"], "powershell")).toBe("git reset --soft HEAD~1; git reset -q; git add -A -- 'a' && git commit -q -m 'x (a)'");
  });
});

describe("branches and blobs", () => {
  it("parses branches and explains staleness", () => {
    const now = Date.UTC(2024, 5, 1);
    const out = `main\t${now / 1000 - 3600}\tAda\torigin/main\t\nold\t${now / 1000 - 200 * 86400}\tBob\torigin/old\t[gone]\n`;
    const bs = parseBranches(out, new Set(["old"]), now);
    expect(bs[0].name).toBe("old");
    expect(staleness(bs[0])).toEqual(["200d old", "merged", "upstream gone"]);
    expect(staleness(bs[1])).toEqual([]);
  });

  it("ranks blobs", () => {
    const out = "commit abc 200\nblob 111 500 a.bin\nblob 222 9000000 big.zip\nblob 111 500 a-renamed.bin\ntree 333 40 dir\n";
    expect(largestBlobs(out).map((b) => `${b.path}:${b.size}`)).toEqual(["big.zip:9000000", "a.bin:500"]);
    expect(humanSize(9_000_000)).toBe("8.6 MB");
    expect(humanSize(900)).toBe("900 B");
  });
});

describe("trailers and misc", () => {
  it("adds trailers once", () => {
    const t = "Co-authored-by: Ada <ada@x.dev>";
    expect(addTrailer("feat: x\n", t)).toBe(`feat: x\n\n${t}\n`);
    expect(addTrailer("feat: x\n\nbody\n\nSigned-off-by: B <b@x>", t)).toBe(`feat: x\n\nbody\n\nSigned-off-by: B <b@x>\n${t}\n`);
    expect(addTrailer(`feat: x\n\n${t}\n`, t)).toBe(`feat: x\n\n${t}\n`);
    expect(parseShortlog("    12\tAda Lovelace <ada@x.dev>\n     3\tBob <b@y>\n")).toEqual([
      { name: "Ada Lovelace", email: "ada@x.dev", commits: 12 },
      { name: "Bob", email: "b@y", commits: 3 },
    ]);
  });

  it("parses blame, grep and clean output", () => {
    const sha = "a".repeat(40);
    const blame = `${sha} 3 7 1\nauthor Ada\nauthor-time 1700000000\nsummary x\n\t// TODO fix\n`;
    expect(blameTimes(blame).get(7)).toEqual({ time: 1_700_000_000_000, author: "Ada", sha });
    expect(parseGitGrep("src/a.ts:12:  // TODO: x\nweird")).toEqual([{ file: "src/a.ts", line: 12, text: "// TODO: x" }]);
    expect(parseCleanDryRun("Would remove tmp/\nWould remove a.log\n")).toEqual(["tmp/", "a.log"]);
  });
});

import { planPreview, planTodo, validatePlan } from "./extras4";

describe("rebase rows", () => {
  it("plans rewords via exec and previews the result", () => {
    const rows = [
      { sha: "a1", subject: "feat: x", action: "pick" as const },
      { sha: "b2", subject: "wip", action: "fixup" as const },
      { sha: "c3", subject: "typo", action: "reword" as const, message: "fix: it's a typo" },
      { sha: "d4", subject: "junk", action: "drop" as const },
    ];
    expect(planTodo(rows)).toBe("pick a1 feat: x\nfixup b2 wip\npick c3 typo\nexec git commit --amend --allow-empty --only -m 'fix: it'\\''s a typo'\ndrop d4 junk\n");
    expect(planPreview(rows)).toEqual(["fix: it's a typo", "feat: x"]);
    expect(validatePlan([{ sha: "a", subject: "s", action: "squash" }])[0]).toMatch(/first kept/);
    expect(validatePlan([{ sha: "a", subject: "s", action: "drop" }])[0]).toMatch(/dropped/);
    expect(() => planTodo([{ sha: "a", subject: "s", action: "reword" }])).toThrow(/no new message/);
  });
});

import { planWarnings } from "./extras4";

describe("plan warnings", () => {
  it("flags fixups after a dropped commit", () => {
    const w = planWarnings([
      { sha: "a", subject: "wip", action: "pick" },
      { sha: "b", subject: "feat", action: "drop" },
      { sha: "c", subject: "fixup! feat", action: "fixup" },
    ]);
    expect(w).toEqual(['"fixup! feat" will be folded into "wip" because the commit above it is dropped']);
  });
});
