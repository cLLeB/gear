import { describe, expect, it } from "vitest";
import { backdropKey } from "./vibrancy";

describe("backdropKey", () => {
  it("is off when the preference is off", () => {
    expect(backdropKey("mica", false, true)).toBe("off");
    expect(backdropKey("vibrancy", false, false)).toBe("off");
  });

  it("is off on platforms without a backdrop even when enabled", () => {
    expect(backdropKey("none", true, true)).toBe("off");
    expect(backdropKey("none", true, false)).toBe("off");
  });

  it("re-keys mica on a light/dark flip", () => {
    expect(backdropKey("mica", true, true)).toBe("on:dark");
    expect(backdropKey("mica", true, false)).toBe("on:light");
  });

  it("keeps one key for vibrancy across modes", () => {
    expect(backdropKey("vibrancy", true, true)).toBe(
      backdropKey("vibrancy", true, false),
    );
  });
});
