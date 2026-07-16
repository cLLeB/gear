import { describe, expect, it, vi } from "vitest";
import { memoize } from "./memoize";

describe("memoize", () => {
  it("caches by arguments", () => {
    const fn = vi.fn((a: number, b: number) => a + b);
    const m = memoize(fn);
    expect(m(1, 2)).toBe(3);
    expect(m(1, 2)).toBe(3);
    expect(fn).toHaveBeenCalledTimes(1);
    m(2, 2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("supports a custom resolver", () => {
    const fn = vi.fn((obj: { id: number }) => obj.id * 2);
    const m = memoize(fn, { resolver: (o) => String(o.id) });
    expect(m({ id: 5 })).toBe(10);
    expect(m({ id: 5 })).toBe(10);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("can clear the cache", () => {
    const fn = vi.fn((n: number) => n);
    const m = memoize(fn);
    m(1);
    m.clear();
    m(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
