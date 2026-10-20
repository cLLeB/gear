import { describe, expect, it } from "vitest";
import { diffLines } from "./AcpConversation";

describe("agent diff view", () => {
  it("shows only the changed lines with a little context", () => {
    const old = ["a", "b", "c", "d", "e", "f"].join("\n");
    const next = ["a", "b", "c", "X", "e", "f"].join("\n");
    expect(diffLines(old, next)).toEqual([
      { sign: " ", text: "b" },
      { sign: " ", text: "c" },
      { sign: "-", text: "d" },
      { sign: "+", text: "X" },
      { sign: " ", text: "e" },
      { sign: " ", text: "f" },
    ]);
  });

  it("treats a missing old text as a new file", () => {
    expect(diffLines(null, "x\ny")).toEqual([
      { sign: "+", text: "x" },
      { sign: "+", text: "y" },
    ]);
  });
});
