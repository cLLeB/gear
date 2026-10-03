import { describe, expect, it } from "vitest";
import { branchNameFromText, isValidBranchName, parseBranches } from "./branches";

describe("parseBranches", () => {
  it("parses for-each-ref output, current first then most recent", () => {
    const out = [
      " \told\t1000\t\t\tOld work",
      "*\tmain\t3000\torigin/main\t[ahead 2, behind 1]\tLatest",
      " \tfeat/x\t2000\torigin/feat/x\t[gone]\tWIP: x",
    ].join("\n");
    const b = parseBranches(out);
    expect(b.map((x) => x.name)).toEqual(["main", "feat/x", "old"]);
    expect(b[0]).toMatchObject({ current: true, ahead: 2, behind: 1, upstream: "origin/main" });
    expect(b[1].gone).toBe(true);
  });
});

describe("branch names", () => {
  it("validates like git check-ref-format", () => {
    expect(isValidBranchName("feat/rulers")).toBe(true);
    for (const bad of ["", "-x", "a..b", "a b", "a~1", "x.lock", "a/", ".hidden", "a//b", "@{x}"]) {
      expect(isValidBranchName(bad)).toBe(false);
    }
  });

  it("derives names from free text", () => {
    expect(branchNameFromText("feat/rulers")).toBe("feat/rulers");
    expect(branchNameFromText("Fix login redirect #123")).toBe("fix/fix-login-redirect-123");
    expect(branchNameFromText("fix: Crash on save")).toBe("fix/crash-on-save");
    expect(branchNameFromText("Add dark mode")).toBe("feat/add-dark-mode");
    expect(branchNameFromText("experiment with café")).toBe("experiment-with-cafe");
  });
});
