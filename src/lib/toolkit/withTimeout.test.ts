import { describe, expect, it } from "vitest";
import { TimeoutError, withTimeout } from "./withTimeout";

describe("withTimeout", () => {
  it("resolves when fast enough", async () => {
    const fast = new Promise<string>((r) => setTimeout(() => r("ok"), 5));
    expect(await withTimeout(fast, 50)).toBe("ok");
  });

  it("rejects on timeout", async () => {
    const slow = new Promise<string>((r) => setTimeout(() => r("late"), 50));
    await expect(withTimeout(slow, 5)).rejects.toBeInstanceOf(TimeoutError);
  });

  it("passes through rejection", async () => {
    const failing = Promise.reject(new Error("boom"));
    await expect(withTimeout(failing, 50)).rejects.toThrow("boom");
  });
});
