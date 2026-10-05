import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { fileLockFilter, isLocked, toggleLock } from "./fileLock";

describe("file lock", () => {
  it("blocks user edits only while locked", () => {
    let state = EditorState.create({ doc: "abc", extensions: [fileLockFilter(() => "/a.txt")] });
    expect(toggleLock("/a.txt")).toBe(true);
    expect(isLocked("/a.txt")).toBe(true);
    state = state.update({ changes: { from: 0, insert: "x" }, userEvent: "input.type" }).state;
    expect(state.doc.toString()).toBe("abc");
    state = state.update({ changes: { from: 0, insert: "y" } }).state; // reload from disk
    expect(state.doc.toString()).toBe("yabc");
    expect(toggleLock("/a.txt")).toBe(false);
    state = state.update({ changes: { from: 0, insert: "x" }, userEvent: "input.type" }).state;
    expect(state.doc.toString()).toBe("xyabc");
  });
});
