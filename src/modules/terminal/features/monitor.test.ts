import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaneMonitors } from "./monitor";

describe("PaneMonitors", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = () => {
    const fired: Array<[number, string]> = [];
    const m = new PaneMonitors({
      fire: (leaf, kind) => fired.push([leaf, kind]),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });
    return { m, fired };
  };

  it("fires activity once on the next output", () => {
    const { m, fired } = make();
    m.arm(1, "activity");
    m.output(2);
    m.output(1);
    m.output(1);
    expect(fired).toEqual([[1, "activity"]]);
    expect(m.isArmed(1)).toBeNull();
  });

  it("fires silence after output stops, restarting on each chunk", () => {
    const { m, fired } = make();
    m.arm(1, "silence", 1000);
    vi.advanceTimersByTime(800);
    m.output(1);
    vi.advanceTimersByTime(800);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(300);
    expect(fired).toEqual([[1, "silence"]]);
  });

  it("can be disarmed", () => {
    const { m, fired } = make();
    m.arm(1, "silence", 100);
    m.disarm(1);
    vi.advanceTimersByTime(500);
    expect(fired).toEqual([]);
  });
});
