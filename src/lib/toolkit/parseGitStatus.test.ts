import { describe, expect, it } from "vitest";
import { parseGitStatus } from "./parseGitStatus";

describe("parseGitStatus", () => {
  it("parses staged and unstaged codes", () => {
    const entries = parseGitStatus("M  a.ts\n M b.ts");
    expect(entries[0]).toMatchObject({ index: "M", working: " ", path: "a.ts", staged: true });
    expect(entries[1]).toMatchObject({ index: " ", working: "M", path: "b.ts", staged: false });
  });

  it("parses untracked files", () => {
    const entries = parseGitStatus("?? new.ts");
    expect(entries[0]).toMatchObject({ path: "new.ts", untracked: true, staged: false });
  });

  it("parses renames", () => {
    const entries = parseGitStatus("R  old.ts -> new.ts");
    expect(entries[0]).toMatchObject({ index: "R", origPath: "old.ts", path: "new.ts" });
  });
});
