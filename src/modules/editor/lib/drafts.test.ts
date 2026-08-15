import { describe, expect, it } from "vitest";
import { MAX_DRAFT_BYTES, parseDraft, shouldBackup } from "./drafts";

describe("parseDraft", () => {
  it("accepts a well-formed draft", () => {
    expect(parseDraft({ text: "hi", mtime: 12, at: 34 })).toEqual({
      text: "hi",
      mtime: 12,
      at: 34,
    });
  });

  it("keeps an empty draft, which is a real edit (file emptied)", () => {
    expect(parseDraft({ text: "", mtime: null, at: 1 })).toEqual({
      text: "",
      mtime: null,
      at: 1,
    });
  });

  it("normalizes a missing or non-numeric mtime to null", () => {
    expect(parseDraft({ text: "hi", mtime: "12" })?.mtime).toBeNull();
    expect(parseDraft({ text: "hi" })?.mtime).toBeNull();
  });

  it.each([
    ["not an object", 42],
    ["null", null],
    ["a missing text field", { mtime: 1 }],
    ["non-string text", { text: 5 }],
  ])("rejects %s", (_label, input) => {
    expect(parseDraft(input)).toBeNull();
  });
});

describe("shouldBackup", () => {
  it("backs up a buffer that differs from what is on disk", () => {
    expect(shouldBackup("edited", "saved")).toBe(true);
  });

  it("does not back up a buffer that matches disk", () => {
    expect(shouldBackup("same", "same")).toBe(false);
  });

  it("treats emptying a file as a real edit worth backing up", () => {
    expect(shouldBackup("", "content")).toBe(true);
  });

  it("refuses a buffer past the size cap", () => {
    expect(shouldBackup("x".repeat(MAX_DRAFT_BYTES + 1), "")).toBe(false);
  });
});
