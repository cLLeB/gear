import { describe, expect, it } from "vitest";
import { browserKey, DEVICES, deviceRect, keyEventInit, toWindowBounds, zoomFactor } from "./nativeBrowser";

describe("forwarded shortcuts", () => {
  it("replays combos with the platform's modifier", () => {
    expect(keyEventInit("mod+shift+p", false)).toMatchObject({ key: "p", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false });
    expect(keyEventInit("mod+shift+p", true)).toMatchObject({ key: "p", ctrlKey: false, metaKey: true, shiftKey: true });
    expect(keyEventInit("ctrl+shift+tab", true)).toMatchObject({ key: "Tab", ctrlKey: true, metaKey: false, shiftKey: true });
    expect(keyEventInit("mod+,", false)).toMatchObject({ key: ",", ctrlKey: true });
    expect(keyEventInit("mod+alt+t", false)).toMatchObject({ key: "t", ctrlKey: true, altKey: true });
    expect(keyEventInit("mod+]", false)).toMatchObject({ key: "]", ctrlKey: true, bubbles: true, cancelable: true });
  });
});

describe("native browser geometry", () => {
  it("derives the UI zoom from the viewport and the root width", () => {
    expect(zoomFactor(1200, 1200)).toBe(1);
    expect(zoomFactor(1200, 1000)).toBeCloseTo(1.2);
    expect(zoomFactor(1200, 1500)).toBeCloseTo(0.8);
    expect(zoomFactor(0, 1000)).toBe(1);
    expect(zoomFactor(1200, 0)).toBe(1);
  });

  it("maps a placeholder rect to window bounds", () => {
    expect(toWindowBounds({ left: 10, top: 20, width: 300, height: 200 }, 1)).toEqual({ x: 10, y: 20, width: 300, height: 200 });
    expect(toWindowBounds({ left: 10, top: 20, width: 300, height: 200 }, 1.25)).toEqual({ x: 12.5, y: 25, width: 375, height: 250 });
    expect(toWindowBounds({ left: 0, top: 0, width: 0, height: 0 }, 1)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("centres device frames and shrinks them to the pane", () => {
    const pane = { left: 100, top: 50, width: 1000, height: 700 };
    expect(deviceRect(pane, DEVICES[0])).toBe(pane);
    expect(deviceRect(pane, DEVICES.find((d) => d.id === "phone")!)).toEqual({ left: 405, top: 50, width: 390, height: 700 });
    expect(deviceRect({ left: 0, top: 0, width: 300, height: 2000 }, DEVICES.find((d) => d.id === "phone")!)).toEqual({ left: 0, top: 578, width: 300, height: 844 });
  });

  it("makes keys that are valid labels and differ per view", () => {
    const a = browserKey(7);
    const b = browserKey(7);
    expect(a).toMatch(/^t7-[a-z0-9]+$/);
    expect(a).not.toBe(b);
  });
});
