import { describe, expect, it } from "vitest";
import { osaDistance, suggestCorrection, toolHint } from "./typoFix";

describe("osaDistance", () => {
  it("counts adjacent transpositions as one edit", () => {
    expect(osaDistance("stauts", "status")).toBe(1);
    expect(osaDistance("gti", "git")).toBe(1);
    expect(osaDistance("kitten", "sitting")).toBe(3);
    expect(osaDistance("", "abc")).toBe(3);
  });
});

describe("toolHint", () => {
  it("reads git's suggestion", () => {
    const out = "git: 'stauts' is not a git command. See 'git --help'.\n\nThe most similar command is\n\tstatus\n";
    expect(toolHint(out)).toBe("status");
  });
  it("reads cargo's suggestion", () => {
    expect(toolHint("error: no such command: `biuld`\n\n\tDid you mean `build`?")).toBe("build");
  });
});

describe("suggestCorrection", () => {
  it("fixes a mistyped program name", () => {
    expect(
      suggestCorrection({ command: "gti status", exitCode: 127, output: "zsh: command not found: gti" }),
    ).toBe("git status");
  });

  it("fixes a mistyped git subcommand, keeping arguments", () => {
    expect(
      suggestCorrection({
        command: "git chekcout -b feat",
        exitCode: 1,
        output: "git: 'chekcout' is not a git command. See 'git --help'.",
      }),
    ).toBe("git checkout -b feat");
  });

  it("prefers the tool's own hint", () => {
    expect(
      suggestCorrection({
        command: "git stat",
        exitCode: 1,
        output: "git: 'stat' is not a git command.\n\nThe most similar commands are\n\tstatus\n\tstash",
      }),
    ).toBe("git status");
  });

  it("learns the user's own programs", () => {
    expect(
      suggestCorrection({
        command: "mytol --x",
        exitCode: 127,
        output: "bash: mytol: command not found",
        knownPrograms: ["mytool"],
      }),
    ).toBe("mytool --x");
  });

  it("does nothing for successes, ordinary failures and far-off words", () => {
    expect(suggestCorrection({ command: "gti", exitCode: 0, output: "" })).toBeNull();
    expect(suggestCorrection({ command: "npm test", exitCode: 1, output: "1 test failed" })).toBeNull();
    expect(
      suggestCorrection({ command: "qwertyuiop", exitCode: 127, output: "command not found: qwertyuiop" }),
    ).toBeNull();
  });
});
