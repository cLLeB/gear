import { describe, expect, it } from "vitest";
import { diffLines } from "./diffLines";

describe("diffLines", () => {
  it("marks equal lines", () => {
    expect(diffLines("a\nb", "a\nb")).toEqual([
      { op: "equal", value: "a" },
      { op: "equal", value: "b" },
    ]);
  });

  it("detects an insertion", () => {
    expect(diffLines("a\nc", "a\nb\nc")).toEqual([
      { op: "equal", value: "a" },
      { op: "insert", value: "b" },
      { op: "equal", value: "c" },
    ]);
  });

  it("detects a deletion", () => {
    expect(diffLines("a\nb\nc", "a\nc")).toEqual([
      { op: "equal", value: "a" },
      { op: "delete", value: "b" },
      { op: "equal", value: "c" },
    ]);
  });

  it("handles full replacement", () => {
    const d = diffLines("x", "y");
    expect(d).toEqual([
      { op: "delete", value: "x" },
      { op: "insert", value: "y" },
    ]);
  });
});
