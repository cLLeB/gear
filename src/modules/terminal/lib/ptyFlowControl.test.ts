import { describe, expect, it, vi } from "vitest";
import { PtyFlowControl } from "./ptyFlowControl";

describe("PtyFlowControl", () => {
  it("stays quiet under the high-water mark", () => {
    const setPaused = vi.fn();
    const flow = new PtyFlowControl(setPaused, 100, 20);
    flow.track(60)();
    flow.track(100)();
    expect(setPaused).not.toHaveBeenCalled();
  });

  it("pauses once past high water and resumes under low water", () => {
    const setPaused = vi.fn();
    const flow = new PtyFlowControl(setPaused, 100, 20);
    const a = flow.track(60);
    const b = flow.track(60);
    expect(setPaused.mock.calls).toEqual([[true]]);
    const c = flow.track(10);
    expect(setPaused).toHaveBeenCalledTimes(1);

    a();
    expect(setPaused).toHaveBeenCalledTimes(1); // 70 left, still above low
    b();
    expect(setPaused.mock.calls).toEqual([[true], [false]]); // 10 left
    c();
    expect(setPaused).toHaveBeenCalledTimes(2);
  });

  it("reset resumes and ignores callbacks from before it", () => {
    const setPaused = vi.fn();
    const flow = new PtyFlowControl(setPaused, 100, 20);
    const stale = flow.track(150);
    flow.reset();
    expect(setPaused.mock.calls).toEqual([[true], [false]]);

    const fresh = flow.track(150);
    expect(setPaused).toHaveBeenLastCalledWith(true);
    stale();
    expect(setPaused).toHaveBeenCalledTimes(3); // the stale callback changed nothing
    fresh();
    expect(setPaused).toHaveBeenLastCalledWith(false);
  });

  it("reset while not paused does not call the backend", () => {
    const setPaused = vi.fn();
    const flow = new PtyFlowControl(setPaused, 100, 20);
    flow.track(10);
    flow.reset();
    expect(setPaused).not.toHaveBeenCalled();
  });
});
