import { describe, expect, it } from "vitest";
import { allowUserInput, isPaneLocked, usePaneLockStore } from "./paneLock";

describe("pane lock", () => {
  it("toggles and blocks typing but not terminal reports", () => {
    expect(usePaneLockStore.getState().toggle(7)).toBe(true);
    expect(isPaneLocked(7)).toBe(true);
    expect(allowUserInput(7, "ls\r")).toBe(false);
    expect(allowUserInput(7, "\x1b[12;40R")).toBe(true);
    expect(allowUserInput(7, "\x1b[I")).toBe(true);
    expect(allowUserInput(8, "anything")).toBe(true);
    usePaneLockStore.getState().toggle(7);
    expect(allowUserInput(7, "ls\r")).toBe(true);
  });
});
