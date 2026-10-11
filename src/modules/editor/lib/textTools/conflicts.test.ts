import { describe, expect, it } from "vitest";
import { parseConflicts, resolve, resolveAll } from "./conflicts";

const doc = [
  "start",
  "<<<<<<< HEAD",
  "ours 1",
  "ours 2",
  "=======",
  "theirs",
  ">>>>>>> feature/x",
  "middle",
  "<<<<<<< HEAD",
  "a",
  "||||||| merged common ancestors",
  "base",
  "=======",
  "b",
  ">>>>>>> main",
  "end",
].join("\n");

describe("parseConflicts", () => {
  it("parses two-way and diff3 blocks with labels", () => {
    const [a, b] = parseConflicts(doc);
    expect(a).toMatchObject({ current: "ours 1\nours 2\n", incoming: "theirs\n", base: null, currentLabel: "HEAD", incomingLabel: "feature/x", startLine: 2 });
    expect(b).toMatchObject({ current: "a\n", base: "base\n", incoming: "b\n", incomingLabel: "main" });
    expect(doc.slice(a.from, a.to).startsWith("<<<<<<< HEAD")).toBe(true);
    expect(doc.slice(a.from, a.to).endsWith(">>>>>>> feature/x\n")).toBe(true);
  });

  it("ignores unterminated markers", () => {
    expect(parseConflicts("<<<<<<< HEAD\nx\n=======\ny\n")).toEqual([]);
  });
});

describe("resolve", () => {
  it("resolves blocks individually and in bulk", () => {
    const [a] = parseConflicts(doc);
    expect(resolve(a, "both")).toBe("ours 1\nours 2\ntheirs\n");
    expect(resolveAll(doc, "incoming")).toEqual({ text: "start\ntheirs\nmiddle\nb\nend", count: 2 });
    expect(resolveAll(doc, "current").text).toBe("start\nours 1\nours 2\nmiddle\na\nend");
  });
});
