import { describe, expect, it, vi } from "vitest";
import { retry } from "./retry";

const noSleep = () => Promise.resolve();

describe("retry", () => {
  it("returns on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    expect(await retry(fn, { sleep: noSleep })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");
    expect(await retry(fn, { sleep: noSleep })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(retry(fn, { attempts: 2, sleep: noSleep })).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("stops when shouldRetry is false", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("nope"));
    await expect(
      retry(fn, { attempts: 5, shouldRetry: () => false, sleep: noSleep }),
    ).rejects.toThrow("nope");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
