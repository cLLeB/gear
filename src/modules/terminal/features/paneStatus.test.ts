import { describe, expect, it } from "vitest";
import { aggregateProgress, parseProgress, usePaneStatusStore } from "./paneStatus";

describe("parseProgress", () => {
  it("parses the OSC 9;4 states", () => {
    expect(parseProgress("4;1;42")).toEqual({ state: "normal", value: 42 });
    expect(parseProgress("4;2;100")).toEqual({ state: "error", value: 100 });
    expect(parseProgress("4;3")).toEqual({ state: "indeterminate", value: 0 });
    expect(parseProgress("4;4;10")).toEqual({ state: "paused", value: 10 });
    expect(parseProgress("4;0")).toEqual({ state: "none", value: 0 });
    expect(parseProgress("4;1;250")?.value).toBe(100);
    expect(parseProgress("Hello")).toBeNull();
  });
});

describe("aggregateProgress", () => {
  it("lets errors win and averages values", () => {
    expect(aggregateProgress([{ state: "normal", value: 20 }, { state: "error", value: 60 }])).toEqual({ state: "error", value: 40 });
    expect(aggregateProgress([{ state: "indeterminate", value: 0 }])).toEqual({ state: "indeterminate", value: 0 });
    expect(aggregateProgress([{ state: "indeterminate", value: 0 }, { state: "normal", value: 50 }])).toEqual({ state: "normal", value: 50 });
    expect(aggregateProgress([])).toBeNull();
  });
});

describe("usePaneStatusStore", () => {
  it("clears progress on state none and tracks attention", () => {
    const s = usePaneStatusStore.getState();
    s.setProgress(1, { state: "normal", value: 5 });
    expect(usePaneStatusStore.getState().progress[1]).toBeTruthy();
    usePaneStatusStore.getState().setProgress(1, { state: "none", value: 0 });
    expect(usePaneStatusStore.getState().progress[1]).toBeUndefined();
    usePaneStatusStore.getState().setAttention(2, true);
    expect(usePaneStatusStore.getState().attention[2]).toBe(true);
    usePaneStatusStore.getState().forget(2);
    expect(usePaneStatusStore.getState().attention[2]).toBeUndefined();
  });
});
