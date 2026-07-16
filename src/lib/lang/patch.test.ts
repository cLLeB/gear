import { describe, expect, it } from "vitest";
import { applyPatch, createPatch, parsePatch, tryApplyPatch } from "./patch";

const OLD = "line1\nline2\nline3\nline4\nline5";
const NEW = "line1\nline2 changed\nline3\nline4\nline5";

describe("patch", () => {
  it("creates a unified diff with a hunk header", () => {
    const patch = createPatch(OLD, NEW);
    expect(patch).toContain("@@");
    expect(patch).toContain("-line2");
    expect(patch).toContain("+line2 changed");
  });

  it("round-trips: applying a generated patch reproduces the new text", () => {
    const patch = createPatch(OLD, NEW);
    expect(applyPatch(OLD, patch).result).toBe(NEW);
  });

  it("parses a patch into hunks", () => {
    const parsed = parsePatch(createPatch(OLD, NEW));
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0].oldStart).toBeGreaterThan(0);
  });

  it("handles multi-region changes", () => {
    const a = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
    const b = a.replace("l2", "X2").replace("l17", "X17");
    expect(applyPatch(a, createPatch(a, b)).result).toBe(b);
  });

  it("reports a failed hunk on mismatch", () => {
    const patch = createPatch(OLD, NEW);
    const result = tryApplyPatch("totally\ndifferent\ncontent\nhere\nnow", patch);
    expect(result.ok).toBe(false);
    expect(result.failedHunk).toBe(0);
  });

  it("produces an empty patch for identical text", () => {
    expect(createPatch(OLD, OLD)).toBe("");
  });
});
