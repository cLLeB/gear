import { describe, expect, it } from "vitest";
import {
  buildConventionalMessage,
  parseBlamePorcelain,
  parseNameStatus,
  parseReflog,
  parseRemotes,
  parseShortlog,
  parseSubmodules,
  pullRequestNumber,
  remoteWebUrl,
  SEP,
  suggestScopes,
} from "./extras2";

describe("git parsers", () => {
  it("reads blame porcelain", () => {
    const out = `${"a".repeat(40)} 12 12 1\nauthor Ada\nauthor-mail <ada@x.dev>\nauthor-time 1700000000\nsummary Fix parser (#42)\n\tcode`;
    expect(parseBlamePorcelain(out)).toEqual({ sha: "a".repeat(40), author: "Ada", email: "ada@x.dev", time: 1_700_000_000_000, summary: "Fix parser (#42)", uncommitted: false });
    expect(parseBlamePorcelain(`${"0".repeat(40)} 1 1 1\nauthor Not Committed Yet`)!.uncommitted).toBe(true);
    expect(pullRequestNumber("Fix parser (#42)")).toBe(42);
    expect(pullRequestNumber("Merge pull request #7 from a/b")).toBe(7);
    expect(pullRequestNumber("See merge request grp/proj!9")).toBe(9);
    expect(pullRequestNumber("plain")).toBeNull();
  });

  it("reads name-status, reflog, shortlog, remotes and submodules", () => {
    expect(parseNameStatus("M\tsrc/a.ts\nR095\told.ts\tnew.ts\nA\tb.md")).toEqual([
      { status: "M", path: "src/a.ts", from: null },
      { status: "R", path: "new.ts", from: "old.ts" },
      { status: "A", path: "b.md", from: null },
    ]);
    expect(parseReflog(`abc${SEP}HEAD@{0}${SEP}checkout: moving from main to dev${SEP}2 hours ago`)[0]).toEqual({
      sha: "abc", ref: "HEAD@{0}", action: "checkout", message: "moving from main to dev", when: "2 hours ago",
    });
    expect(parseShortlog("   120\tAda Lovelace <ada@x.dev>\n     3\tBob <b@x>")).toEqual([
      { commits: 120, name: "Ada Lovelace", email: "ada@x.dev" },
      { commits: 3, name: "Bob", email: "b@x" },
    ]);
    expect(parseRemotes("origin\tgit@github.com:a/b.git (fetch)\norigin\tgit@github.com:a/b.git (push)")).toEqual([
      { name: "origin", fetch: "git@github.com:a/b.git", push: "git@github.com:a/b.git" },
    ]);
    expect(remoteWebUrl("git@github.com:a/b.git")).toBe("https://github.com/a/b");
    expect(remoteWebUrl("ssh://git@gitlab.com:2222/g/p.git")).toBe("https://gitlab.com/g/p");
    expect(remoteWebUrl("https://user@bitbucket.org/t/r.git")).toBe("https://bitbucket.org/t/r");
    expect(parseSubmodules(" abc123 libs/x (v1.2)\n-def456 vendor/y\n+0aa11 z (heads/main)")).toEqual([
      { path: "libs/x", sha: "abc123", state: "ok", describe: "v1.2" },
      { path: "vendor/y", sha: "def456", state: "uninitialized", describe: "" },
      { path: "z", sha: "0aa11", state: "modified", describe: "heads/main" },
    ]);
  });
});

describe("conventional commits", () => {
  it("builds messages with scope, breaking change and refs", () => {
    expect(buildConventionalMessage({ type: "feat", scope: "auth", subject: "Add OAuth login.", issues: "12, JIRA-9" })).toBe(
      "feat(auth): add OAuth login\n\nRefs: #12\nRefs: JIRA-9",
    );
    expect(buildConventionalMessage({ type: "fix", breaking: true, subject: "drop v1 API", body: "Clients must use /v2." })).toBe(
      "fix!: drop v1 API\n\nClients must use /v2.\n\nBREAKING CHANGE: Clients must use /v2.",
    );
  });

  it("suggests scopes from paths", () => {
    expect(suggestScopes(["src/modules/terminal/a.ts", "src/modules/terminal/b.ts", "docs/x.md"])).toEqual(["modules", "docs"]);
    expect(suggestScopes(["packages/api/src/x.ts", "packages/web/y.ts", "packages/api/z.ts"])).toEqual(["api", "web"]);
  });
});
