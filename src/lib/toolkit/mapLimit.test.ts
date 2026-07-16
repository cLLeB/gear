import { describe, expect, it } from "vitest";
import { mapLimit } from "./mapLimit";

const tick = () => new Promise((r) => setTimeout(r, 3));

describe("mapLimit", () => {
  it("maps preserving order", async () => {
    const out = await mapLimit([1, 2, 3, 4], 2, async (n) => {
      await tick();
      return n * n;
    });
    expect(out).toEqual([1, 4, 9, 16]);
  });

  it("passes the index", async () => {
    const out = await mapLimit(["a", "b"], 1, async (v, i) => `${v}${i}`);
    expect(out).toEqual(["a0", "b1"]);
  });

  it("bounds concurrency", async () => {
    let running = 0;
    let peak = 0;
    await mapLimit([1, 2, 3, 4, 5], 2, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      running -= 1;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });
});
