import { describe, expect, it } from "vitest";
import { splitCommandChain } from "./splitCommandChain";

describe("splitCommandChain", () => {
  it("splits on && and ||", () => {
    expect(splitCommandChain("a && b || c")).toEqual([
      { command: "a", operator: "&&" },
      { command: "b", operator: "||" },
      { command: "c", operator: null },
    ]);
  });

  it("splits on pipes and semicolons", () => {
    expect(splitCommandChain("ls | grep x; echo done").map((s) => s.command)).toEqual([
      "ls",
      "grep x",
      "echo done",
    ]);
  });

  it("ignores operators inside quotes", () => {
    expect(splitCommandChain('echo "a && b"')).toEqual([
      { command: 'echo "a && b"', operator: null },
    ]);
  });
});
