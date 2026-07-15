import { describe, expect, it } from "vitest";
import { parseGitRemoteUrl } from "./gitRemoteUrl";

describe("parseGitRemoteUrl", () => {
  it("parses scp-style ssh", () => {
    expect(parseGitRemoteUrl("git@github.com:owner/repo.git")).toEqual({
      host: "github.com",
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses https", () => {
    expect(parseGitRemoteUrl("https://gitlab.com/group/sub/repo.git")).toEqual({
      host: "gitlab.com",
      owner: "group/sub",
      repo: "repo",
    });
  });

  it("parses ssh:// with port", () => {
    expect(parseGitRemoteUrl("ssh://git@host.com:2222/owner/repo")).toEqual({
      host: "host.com",
      owner: "owner",
      repo: "repo",
    });
  });

  it("rejects nonsense", () => {
    expect(parseGitRemoteUrl("not a url")).toBeNull();
  });
});
