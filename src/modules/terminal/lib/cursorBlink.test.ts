import { describe, expect, it } from "vitest";

import { shouldCursorBlink } from "./cursorBlink";

describe("shouldCursorBlink", () => {
  it("blinks when enabled and the window is active", () => {
    expect(shouldCursorBlink(true, true, true)).toBe(true);
    // No longer gated on per-slot focus.
    expect(shouldCursorBlink(true, true, false)).toBe(true);
  });

  it("never blinks when disabled", () => {
    expect(shouldCursorBlink(false, true, true)).toBe(false);
  });

  it("never blinks while the window is inactive", () => {
    expect(shouldCursorBlink(true, false, true)).toBe(false);
  });
});
