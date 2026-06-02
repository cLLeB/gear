import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "./api";
import { fileDiffStat, positionInRange } from "./format";

function event(partial: Partial<TimelineEvent>): TimelineEvent {
  return {
    id: 1,
    ts: 0,
    kind: "file",
    actor: "user",
    file_path: "a.txt",
    summary: "edit",
    payload: null,
    parent_id: null,
    ...partial,
  };
}

describe("fileDiffStat", () => {
  it("extracts op/added/removed from a file payload", () => {
    const e = event({
      payload: { kind: "file", op: "modified", added: 5, removed: 2 },
    });
    expect(fileDiffStat(e)).toEqual({ op: "modified", added: 5, removed: 2 });
  });

  it("returns null for non-file events", () => {
    expect(fileDiffStat(event({ kind: "cmd", payload: {} }))).toBeNull();
  });

  it("returns null for a non-object payload", () => {
    expect(fileDiffStat(event({ payload: null }))).toBeNull();
  });

  it("defaults missing numeric fields to zero and op to modified", () => {
    expect(fileDiffStat(event({ payload: { kind: "file" } }))).toEqual({
      op: "modified",
      added: 0,
      removed: 0,
    });
  });
});

describe("positionInRange", () => {
  it("maps a timestamp to a clamped [0,1] fraction", () => {
    expect(positionInRange(50, 0, 100)).toBe(0.5);
    expect(positionInRange(-10, 0, 100)).toBe(0);
    expect(positionInRange(200, 0, 100)).toBe(1);
  });

  it("returns 0 for a degenerate range", () => {
    expect(positionInRange(5, 10, 10)).toBe(0);
  });
});
