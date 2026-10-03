import { describe, expect, it } from "vitest";
import { buildPermalink, detectForge } from "./permalink";

const sha = "0123456789abcdef0123456789abcdef01234567";

describe("buildPermalink", () => {
  it("builds GitHub links from ssh and https remotes", () => {
    expect(buildPermalink({ remoteUrl: "git@github.com:cLLeB/gear.git", ref: sha, path: "src/app/App.tsx", startLine: 10 })).toBe(
      `https://github.com/cLLeB/gear/blob/${sha}/src/app/App.tsx#L10`,
    );
    expect(buildPermalink({ remoteUrl: "https://github.com/a/b", ref: sha, path: "x y.ts", startLine: 3, endLine: 7 })).toBe(
      `https://github.com/a/b/blob/${sha}/x%20y.ts#L3-L7`,
    );
  });

  it("builds GitLab (nested groups), Bitbucket and Gitea links", () => {
    expect(buildPermalink({ remoteUrl: "git@gitlab.example.com:group/sub/proj.git", ref: sha, path: "a.go", startLine: 1, endLine: 4 })).toBe(
      `https://gitlab.example.com/group/sub/proj/-/blob/${sha}/a.go#L1-4`,
    );
    expect(buildPermalink({ remoteUrl: "git@bitbucket.org:team/repo.git", ref: sha, path: "a.py", startLine: 5 })).toBe(
      `https://bitbucket.org/team/repo/src/${sha}/a.py#lines-5`,
    );
    expect(buildPermalink({ remoteUrl: "https://codeberg.org/me/proj.git", ref: sha, path: "r.rs", startLine: 2 })).toBe(
      `https://codeberg.org/me/proj/src/commit/${sha}/r.rs#L2`,
    );
  });

  it("builds Azure DevOps links", () => {
    expect(buildPermalink({ remoteUrl: "git@ssh.dev.azure.com:v3/org/proj/repo", ref: sha, path: "src/a.cs", startLine: 8 })).toBe(
      `https://dev.azure.com/org/proj/_git/repo?path=/src/a.cs&version=GC${sha}&line=8&lineEnd=9&lineStartColumn=1&lineEndColumn=1`,
    );
  });

  it("returns null for unparseable remotes", () => {
    expect(buildPermalink({ remoteUrl: "/local/path", ref: sha, path: "a", startLine: 1 })).toBeNull();
  });
});

describe("detectForge", () => {
  it("defaults unknown hosts to GitLab", () => {
    expect(detectForge("git.company.internal")).toBe("gitlab");
    expect(detectForge("github.enterprise.co")).toBe("github");
  });
});

import { buildPullRequestUrl } from "./permalink";

describe("buildPullRequestUrl", () => {
  it("builds compare / new-MR URLs per forge", () => {
    expect(buildPullRequestUrl("git@github.com:o/r.git", "feat/x", "main")).toBe("https://github.com/o/r/compare/main...feat/x?expand=1");
    expect(buildPullRequestUrl("https://gitlab.com/g/r.git", "fix/y", "main")).toBe(
      "https://gitlab.com/g/r/-/merge_requests/new?merge_request%5Bsource_branch%5D=fix%2Fy&merge_request%5Btarget_branch%5D=main",
    );
    expect(buildPullRequestUrl("git@bitbucket.org:t/r.git", "a", "dev")).toBe("https://bitbucket.org/t/r/pull-requests/new?source=a&dest=dev");
    expect(buildPullRequestUrl("git@git.sr.ht:~me/r", "a", "main")).toBeNull();
  });
});
