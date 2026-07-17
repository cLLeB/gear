import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "./eventEmitter";

type Events = {
  ping: number;
  done: string;
};

describe("EventEmitter", () => {
  it("delivers payloads to listeners", () => {
    const ee = new EventEmitter<Events>();
    const fn = vi.fn();
    ee.on("ping", fn);
    ee.emit("ping", 42);
    expect(fn).toHaveBeenCalledWith(42);
  });

  it("unsubscribes via returned disposer", () => {
    const ee = new EventEmitter<Events>();
    const fn = vi.fn();
    const off = ee.on("ping", fn);
    off();
    ee.emit("ping", 1);
    expect(fn).not.toHaveBeenCalled();
  });

  it("once fires a single time", () => {
    const ee = new EventEmitter<Events>();
    const fn = vi.fn();
    ee.once("done", fn);
    ee.emit("done", "a");
    ee.emit("done", "b");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("counts listeners", () => {
    const ee = new EventEmitter<Events>();
    ee.on("ping", () => {});
    expect(ee.listenerCount("ping")).toBe(1);
  });
});
