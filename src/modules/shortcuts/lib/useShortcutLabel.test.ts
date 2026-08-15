import { describe, expect, it } from "vitest";
import { getBindingTokens, SHORTCUTS } from "../shortcuts";
import { resolveShortcutLabel } from "./useShortcutLabel";

const paletteDefault = SHORTCUTS.find(
  (s) => s.id === "commandPalette.open",
)?.defaultBindings[0];

// Token formatting is platform-dependent (⌘/⇧ on macOS, Ctrl/Shift elsewhere),
// so assert against getBindingTokens rather than a hardcoded string — what is
// under test here is which binding gets picked, not how it is rendered.
describe("resolveShortcutLabel", () => {
  it("formats the default binding when there is no user override", () => {
    expect(resolveShortcutLabel({}, "commandPalette.open")).toBe(
      getBindingTokens(paletteDefault).join(" "),
    );
  });

  it("prefers a user override over the default binding", () => {
    const override = { ctrl: true, shift: true, key: "k" };
    const label = resolveShortcutLabel(
      { "commandPalette.open": [override] },
      "commandPalette.open",
    );
    expect(label).toBe(getBindingTokens(override).join(" "));
    expect(label).not.toBe(getBindingTokens(paletteDefault).join(" "));
  });

  it("uses only the first binding when several are configured", () => {
    const first = { ctrl: true, key: "1" };
    expect(
      resolveShortcutLabel(
        { "commandPalette.open": [first, { ctrl: true, key: "2" }] },
        "commandPalette.open",
      ),
    ).toBe(getBindingTokens(first).join(" "));
  });

  it("returns an empty label when an override is present but empty", () => {
    expect(
      resolveShortcutLabel({ "commandPalette.open": [] }, "commandPalette.open"),
    ).toBe("");
  });

  it("resolves a default binding for every registered shortcut", () => {
    for (const s of SHORTCUTS) {
      expect(resolveShortcutLabel({}, s.id)).toBe(
        getBindingTokens(s.defaultBindings[0]).join(" "),
      );
    }
  });
});
