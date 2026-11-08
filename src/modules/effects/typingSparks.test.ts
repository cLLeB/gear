import { describe, expect, it } from "vitest";
import { isTypingKey } from "./typingSparks";

const key = (k: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey", boolean>> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe("isTypingKey", () => {
  it("accepts printable characters and editing keys", () => {
    for (const k of ["a", "Z", "7", " ", "{", "é", "Backspace", "Enter", "Delete"]) {
      expect(isTypingKey(key(k))).toBe(true);
    }
  });

  it("ignores navigation and modifier-only keys", () => {
    for (const k of ["ArrowLeft", "Shift", "Control", "Tab", "Escape", "F5", "PageDown"]) {
      expect(isTypingKey(key(k))).toBe(false);
    }
  });

  it("ignores shortcuts", () => {
    expect(isTypingKey(key("c", { ctrlKey: true }))).toBe(false);
    expect(isTypingKey(key("k", { metaKey: true }))).toBe(false);
    expect(isTypingKey(key("x", { altKey: true }))).toBe(false);
  });
});
