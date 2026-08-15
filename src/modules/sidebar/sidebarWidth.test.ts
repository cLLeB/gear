import { describe, expect, it } from "vitest";
import { shouldPersistSidebarWidth } from "./sidebarWidth";

describe("shouldPersistSidebarWidth", () => {
  it("only persists a positive width from direct user interaction", () => {
    expect(shouldPersistSidebarWidth(320, true)).toBe(true);
    expect(shouldPersistSidebarWidth(320, false)).toBe(false);
    expect(shouldPersistSidebarWidth(0, true)).toBe(false);
  });

  it("rejects a collapsed or negative width even while dragging", () => {
    expect(shouldPersistSidebarWidth(0, false)).toBe(false);
    expect(shouldPersistSidebarWidth(-10, true)).toBe(false);
  });
});
