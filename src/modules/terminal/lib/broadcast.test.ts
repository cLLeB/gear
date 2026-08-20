import { afterEach, describe, expect, it, vi } from "vitest";
import {
  broadcastPeers,
  broadcastTargets,
  isBroadcastEnabled,
  resetBroadcastForTests,
  setBroadcastEnabled,
  setBroadcastPeerResolver,
  subscribeBroadcast,
  toggleBroadcast,
} from "./broadcast";

afterEach(() => resetBroadcastForTests());

describe("broadcastTargets", () => {
  it("excludes the pane the keystroke came from", () => {
    expect(broadcastTargets([1, 2, 3], 2)).toEqual([1, 3]);
  });

  it("drops duplicates so a shell cannot be typed into twice", () => {
    expect(broadcastTargets([1, 1, 2, 2, 3], 3)).toEqual([1, 2]);
  });

  it("returns nothing when the source is the only pane", () => {
    expect(broadcastTargets([7], 7)).toEqual([]);
  });

  it("preserves pane order", () => {
    expect(broadcastTargets([5, 1, 9], 1)).toEqual([5, 9]);
  });

  it("handles an empty peer list", () => {
    expect(broadcastTargets([], 1)).toEqual([]);
  });
});

describe("broadcast state", () => {
  it("starts disabled", () => {
    expect(isBroadcastEnabled()).toBe(false);
  });

  it("toggles and reports the new value", () => {
    expect(toggleBroadcast()).toBe(true);
    expect(isBroadcastEnabled()).toBe(true);
    expect(toggleBroadcast()).toBe(false);
  });

  it("notifies subscribers only on a real change", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeBroadcast(listener);

    setBroadcastEnabled(false);
    expect(listener).not.toHaveBeenCalled();

    setBroadcastEnabled(true);
    expect(listener).toHaveBeenCalledTimes(1);

    setBroadcastEnabled(true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setBroadcastEnabled(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("broadcastPeers", () => {
  it("returns nothing while broadcast is off", () => {
    setBroadcastPeerResolver(() => [1, 2, 3]);
    expect(broadcastPeers(1)).toEqual([]);
  });

  it("returns the sibling panes once enabled", () => {
    setBroadcastPeerResolver(() => [1, 2, 3]);
    setBroadcastEnabled(true);
    expect(broadcastPeers(1)).toEqual([2, 3]);
  });

  it("reflects a resolver that knows about no siblings", () => {
    setBroadcastPeerResolver(() => [4]);
    setBroadcastEnabled(true);
    expect(broadcastPeers(4)).toEqual([]);
  });

  it("goes quiet again as soon as broadcast is turned off", () => {
    setBroadcastPeerResolver(() => [1, 2]);
    setBroadcastEnabled(true);
    expect(broadcastPeers(1)).toEqual([2]);
    setBroadcastEnabled(false);
    expect(broadcastPeers(1)).toEqual([]);
  });
});
