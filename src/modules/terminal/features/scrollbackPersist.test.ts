import { describe, expect, it } from "vitest";
import { restoreDivider, trimRestored } from "./scrollbackPersist";

describe("scrollback restore", () => {
  it("trims to the last lines and drops trailing blank space", () => {
    expect(trimRestored("a\r\nb\r\nc\r\n\r\n   \x1b[0m", 2)).toBe("b\r\nc");
  });

  it("keeps text that only looks like the tail of a colour code", () => {
    expect(trimRestored("12m\r\n")).toBe("12m");
    expect(trimRestored("a[0m \x1b[1;32m\x1b[0m\r\n")).toBe("a[0m");
    expect(trimRestored("\x1b[0m\r\n  ")).toBe("");
  });

  it("stays fast on a long run of blank lines before the last text", () => {
    const started = Date.now();
    expect(trimRestored(`a${"\r\n".repeat(5000)}b\r\n`, 1)).toBe("b");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("labels the divider with the age", () => {
    const now = Date.UTC(2026, 0, 1, 12);
    expect(restoreDivider(now - 5 * 60_000, now)).toContain("restored session · 5 min ago");
    expect(restoreDivider(now - 3 * 3600_000, now)).toContain("3 h ago");
    expect(restoreDivider(0, now)).toContain("──── restored session ────");
  });
});
