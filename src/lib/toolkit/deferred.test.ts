import { describe, expect, it } from "vitest";
import { deferred } from "./deferred";

describe("deferred", () => {
  it("resolves externally", async () => {
    const d = deferred<number>();
    setTimeout(() => d.resolve(42), 1);
    expect(await d.promise).toBe(42);
  });

  it("rejects externally", async () => {
    const d = deferred<number>();
    d.reject(new Error("nope"));
    await expect(d.promise).rejects.toThrow("nope");
  });
});
