import { describe, expect, it } from "vitest";
import { extractCommandName, isDangerousCommand } from "./commandInfo";

describe("extractCommandName", () => {
  it("returns the executable base name", () => {
    expect(extractCommandName("/usr/bin/git status")).toBe("git");
    expect(extractCommandName("node script.js")).toBe("node");
  });

  it("skips env-var assignments", () => {
    expect(extractCommandName("FOO=bar BAZ=1 npm run dev")).toBe("npm");
  });

  it("returns null for empty input", () => {
    expect(extractCommandName("   ")).toBeNull();
  });
});

describe("isDangerousCommand", () => {
  it("flags rm -rf", () => {
    expect(isDangerousCommand("rm -rf /")).toBe(true);
    expect(isDangerousCommand("sudo rm -r ~/data")).toBe(true);
  });

  it("flags force push and fork bombs", () => {
    expect(isDangerousCommand("git push origin main --force")).toBe(true);
    expect(isDangerousCommand(":(){ :|:& };:")).toBe(true);
  });

  it("passes safe commands", () => {
    expect(isDangerousCommand("ls -la")).toBe(false);
    expect(isDangerousCommand("git status")).toBe(false);
  });
});
