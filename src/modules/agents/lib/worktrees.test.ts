import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/ai/lib/native", () => ({ native: {} }));
vi.mock("@/modules/git-actions/gitCli", () => ({ git: vi.fn() }));

import { createAgentPanePlan } from "./launcher";
import { agentBranchName, agentWorktreePath, isEnvFile, launchStamp, parseShortstat } from "./worktrees";

describe("agent worktree names", () => {
  it("makes branch names that are safe and grouped under agent/", () => {
    expect(agentBranchName("claude", "k3x9a", 2)).toBe("agent/claude-k3x9a-2");
    expect(agentBranchName("Open Code!", "k3x9a", 1)).toBe("agent/open-code-k3x9a-1");
  });

  it("puts worktrees next to the repository, not inside it", () => {
    expect(agentWorktreePath("C:\\code\\gear", "agent/claude-k3x9a-1")).toBe("C:/code/.gear-worktrees/gear/agent-claude-k3x9a-1");
    expect(agentWorktreePath("/home/me/app/", "agent/codex-a-2")).toBe("/home/me/.gear-worktrees/app/agent-codex-a-2");
  });

  it("stamps launches with a short, changing id", () => {
    expect(launchStamp(1_700_000_000_000)).toHaveLength(5);
    expect(launchStamp(1_700_000_000_000)).not.toBe(launchStamp(1_700_000_060_000));
  });
});

describe("isEnvFile", () => {
  it("copies real env files but not templates", () => {
    expect([".env", ".env.local", ".env.development.local"].every(isEnvFile)).toBe(true);
    expect([".env.example", ".env.sample", ".envrc", "env", ".environment"].some(isEnvFile)).toBe(false);
  });
});

describe("parseShortstat", () => {
  it("reads files, insertions and deletions", () => {
    expect(parseShortstat(" 3 files changed, 12 insertions(+), 4 deletions(-)\n")).toEqual({ files: 3, insertions: 12, deletions: 4 });
    expect(parseShortstat(" 1 file changed, 1 insertion(+)\n")).toEqual({ files: 1, insertions: 1, deletions: 0 });
    expect(parseShortstat("")).toEqual({ files: 0, insertions: 0, deletions: 0 });
  });
});

describe("createAgentPanePlan with worktrees", () => {
  it("gives each pane its own folder", () => {
    let id = 0;
    const plan = createAgentPanePlan(3, () => ++id, "/repo", ["/wt/1", "/wt/2", "/wt/3"]);
    const cwds: string[] = [];
    const walk = (n: typeof plan.paneTree): void => {
      if (n.kind === "leaf") cwds.push(n.cwd as string);
      else n.children.forEach(walk);
    };
    walk(plan.paneTree);
    expect(cwds).toEqual(["/wt/1", "/wt/2", "/wt/3"]);
  });
});
