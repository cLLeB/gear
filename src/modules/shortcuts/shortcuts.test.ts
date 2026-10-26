import { describe, expect, it } from "vitest";
import { MOD_PROP } from "@/lib/platform";
import { getBindingTokens, type KeyBinding, matchBinding,
  SHORTCUTS, } from "./shortcuts";

// These tests run in the vitest node environment, where the Tauri OS plugin is
// unavailable so `IS_MAC` resolves to false. That makes the non-mac token
// branch deterministic across host platforms.

function event(over: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "",
    code: "",
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...over,
  } as KeyboardEvent;
}

describe("getBindingTokens", () => {
  it("returns nothing for an undefined binding", () => {
    expect(getBindingTokens(undefined)).toEqual([]);
  });

  it("lists modifiers in order, then the key", () => {
    const binding: KeyBinding = { key: "k", ctrl: true, shift: true };
    expect(getBindingTokens(binding)).toEqual(["Ctrl", "Shift", "K"]);
  });

  it("labels space and arrow keys", () => {
    expect(getBindingTokens({ key: " ", meta: true })).toEqual([
      "Win",
      "Space",
    ]);
    expect(getBindingTokens({ key: "ArrowUp", alt: true })).toEqual([
      "Alt",
      "↑",
    ]);
  });

  it("uppercases a single-character key", () => {
    expect(getBindingTokens({ key: "c" })).toEqual(["C"]);
  });
});

describe("matchBinding", () => {
  it("matches when key and all modifiers agree", () => {
    expect(
      matchBinding(event({ key: "c", ctrlKey: true }), {
        key: "c",
        ctrl: true,
      }),
    ).toBe(true);
  });

  it("matches the key case-insensitively", () => {
    expect(
      matchBinding(event({ key: "C", ctrlKey: true }), {
        key: "c",
        ctrl: true,
      }),
    ).toBe(true);
  });

  it("falls back to the physical key for Shift bindings", () => {
    const binding = { key: ".", ctrl: true, shift: true };
    expect(matchBinding(event({ key: ">", code: "Period", ctrlKey: true, shiftKey: true }), binding)).toBe(true);
    expect(matchBinding(event({ key: ">", code: "Comma", ctrlKey: true, shiftKey: true }), binding)).toBe(false);
    // Without Shift in the binding there's no fallback.
    expect(matchBinding(event({ key: ">", code: "Period", ctrlKey: true }), { key: ".", ctrl: true })).toBe(false);
  });

  it("fails when a required modifier is missing", () => {
    expect(matchBinding(event({ key: "c" }), { key: "c", ctrl: true })).toBe(
      false,
    );
  });

  it("fails when an extra modifier is pressed", () => {
    expect(
      matchBinding(event({ key: "c", ctrlKey: true, shiftKey: true }), {
        key: "c",
        ctrl: true,
      }),
    ).toBe(false);
  });

  it("falls back to the physical code for alt combinations", () => {
    // Alt often rewrites e.key (here to "ç"); the binding still matches via e.code.
    expect(
      matchBinding(event({ key: "ç", code: "KeyC", altKey: true }), {
        key: "c",
        alt: true,
      }),
    ).toBe(true);
    expect(
      matchBinding(event({ key: "ç", code: "KeyD", altKey: true }), {
        key: "c",
        alt: true,
      }),
    ).toBe(false);
  });

  it("only accepts digit keys for the jump-to-tab shortcut", () => {
    expect(
      matchBinding(event({ key: "3" }), { key: "1" }, "tab.selectByIndex"),
    ).toBe(true);
    expect(
      matchBinding(event({ key: "x" }), { key: "1" }, "tab.selectByIndex"),
    ).toBe(false);
  });
});

describe("SHORTCUTS registry", () => {
  it("binds Mod+S to editor.save", () => {
    const save = SHORTCUTS.find((s) => s.id === "editor.save");
    expect(save).toBeDefined();
    expect(save!.defaultBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "s", [MOD_PROP]: true }),
      ]),
    );
  });

  it("binds both Mod+Y and Mod+Shift+Z to editor.redo", () => {
    const redo = SHORTCUTS.find((s) => s.id === "editor.redo");
    expect(redo!.defaultBindings).toEqual([
      { [MOD_PROP]: true, key: "y" },
      { [MOD_PROP]: true, shift: true, key: "z" },
    ]);
  });
});

describe("default bindings off macOS", () => {
  // Readline keys every shell relies on: end of input, end of line, previous
  // command, reverse search, kill line, delete word. A global shortcut on any
  // of them would swallow it before the terminal sees it.
  const READLINE = ["d", "e", "p", "r", "u", "w"];

  it("leave the shell's readline keys alone", () => {
    const taken = SHORTCUTS.filter((s) => s.group !== "Editor").flatMap((s) =>
      s.defaultBindings
        .filter(
          (b) =>
            b.ctrl &&
            !b.shift &&
            !b.alt &&
            !b.meta &&
            READLINE.includes(b.key.toLowerCase()),
        )
        .map((b) => `${s.id}: Ctrl+${b.key}`),
    );
    expect(taken).toEqual([]);
  });
});
