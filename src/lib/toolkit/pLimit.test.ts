import { describe, expect, it } from "vitest";
import { pLimit } from "./pLimit";

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("pLimit", () => {
  it("caps concurrency", async () => {
    const limit = pLimit(2);
    let running = 0;
    let peak = 0;
    const task = () =>
      limit(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await tick();
        running -= 1;
      });
    await Promise.all(Array.from({ length: 6 }, task));
    expect(peak).toBe(2);
  });

  it("returns task results in order", async () => {
    const limit = pLimit(1);
    const results = await Promise.all([1, 2, 3].map((n) => limit(async () => n * 2)));
    expect(results).toEqual([2, 4, 6]);
  });

  it("propagates rejections", async () => {
    const limit = pLimit(2);
    await expect(limit(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });

  it("validates concurrency", () => {
    expect(() => pLimit(0)).toThrow();
  });
});
