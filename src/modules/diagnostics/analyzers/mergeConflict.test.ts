import { describe, expect, it } from "vitest";
import { DiagnosticsEngine } from "../engine";
import { mergeConflictAnalyzer } from "./mergeConflict";

const engine = new DiagnosticsEngine().register(mergeConflictAnalyzer);
const run = (src: string) => engine.run(src, "javascript");

const CONFLICT = [
  "line one",
  "<<<<<<< HEAD",
  "our change",
  "=======",
  "their change",
  ">>>>>>> feature",
  "line two",
].join("\n");

describe("mergeConflictAnalyzer", () => {
  it("detects a full conflict region", () => {
    const d = run(CONFLICT);
    expect(d).toHaveLength(1);
    expect(d[0].code).toBe("merge-conflict");
  });

  it("handles diff3 base markers", () => {
    const src = "<<<<<<< HEAD\na\n||||||| base\nb\n=======\nc\n>>>>>>> x\n";
    expect(run(src)).toHaveLength(1);
  });

  it("flags an unterminated start marker", () => {
    expect(run("<<<<<<< HEAD\nstuff\n")[0].message).toContain("Unterminated");
  });

  it("is clean without markers", () => {
    expect(run("just some code\n")).toHaveLength(0);
  });
});
