import { describe, expect, it } from "vitest";
import { buildSuggestPrompt, cleanSuggestedCommand } from "./suggestCommand";

describe("cleanSuggestedCommand", () => {
  it.each([
    ["find . -name '*.log' -mtime +7", "find . -name '*.log' -mtime +7"],
    ["```bash\n$ du -sh * | sort -h\n```", "du -sh * | sort -h"],
    ["`git log --oneline -5`", "git log --oneline -5"],
    ["tar -czf out.tgz \\\n  src", "tar -czf out.tgz src"],
    ["ls -la\nThis lists files.", "ls -la"],
    ["PS C:\\> Get-ChildItem -Recurse", "Get-ChildItem -Recurse"],
  ])("%s", (reply, command) => {
    expect(cleanSuggestedCommand(reply)).toEqual({ command });
  });

  it("surfaces refusals and rejects empty replies", () => {
    expect(cleanSuggestedCommand("# cannot: that would delete your disk")).toEqual({ refusal: "that would delete your disk" });
    expect(cleanSuggestedCommand("   ")).toBeNull();
  });
});

describe("buildSuggestPrompt", () => {
  it("includes the environment", () => {
    expect(buildSuggestPrompt(" list ports ", { os: "macOS", shell: "zsh", cwd: "/repo" })).toBe(
      "OS: macOS\nShell: zsh\nWorking directory: /repo\nRequest: list ports",
    );
  });
});
