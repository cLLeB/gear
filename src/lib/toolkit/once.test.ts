import { describe, expect, it, vi } from "vitest";
import { once } from "./once";

describe("once", () => {
  it("runs the function only once", () => {
    const fn = vi.fn(() => 42);
    const o = once(fn);
    expect(o()).toBe(42);
    expect(o()).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("tracks called state", () => {
    const o = once(() => 1);
    expect(o.called).toBe(false);
    o();
    expect(o.called).toBe(true);
  });

  it("can reset", () => {
    const fn = vi.fn(() => 1);
    const o = once(fn);
    o();
    o.reset();
    o();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
