import { describe, expect, it } from "vitest";
import { diffChars } from "./diffChars";

describe("diffChars", () => {
  it("returns equal runs for identical strings", () => {
    expect(diffChars("abc", "abc")).toEqual([{ op: "equal", value: "abc" }]);
  });

  it("detects an inserted run", () => {
    expect(diffChars("ac", "abc")).toEqual([
      { op: "equal", value: "a" },
      { op: "insert", value: "b" },
      { op: "equal", value: "c" },
    ]);
  });

  it("detects a deleted run", () => {
    expect(diffChars("abbc", "ac")).toEqual([
      { op: "equal", value: "a" },
      { op: "delete", value: "bb" },
      { op: "equal", value: "c" },
    ]);
  });

  it("reconstructs both sides", () => {
    const parts = diffChars("kitten", "sitting");
    const a = parts.filter((p) => p.op !== "insert").map((p) => p.value).join("");
    const b = parts.filter((p) => p.op !== "delete").map((p) => p.value).join("");
    expect(a).toBe("kitten");
    expect(b).toBe("sitting");
  });
});
