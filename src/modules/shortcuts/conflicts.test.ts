import { describe, expect, it } from "vitest";
import { chordKey, findShortcutConflicts } from "./conflicts";
import { SHORTCUTS, type Shortcut } from "./shortcuts";

describe("findShortcutConflicts", () => {
  it("has no conflicts among the default bindings", () => {
    expect(findShortcutConflicts(SHORTCUTS)).toEqual([]);
  });

  it("reports user overrides that collide, first match first", () => {
    const list: Shortcut[] = [
      { id: "tab.new", label: "a", group: "Tabs", defaultBindings: [{ ctrl: true, key: "t" }] },
      { id: "tab.close", label: "b", group: "Tabs", defaultBindings: [{ ctrl: true, key: "w" }] },
    ];
    expect(findShortcutConflicts(list, { "tab.close": [{ ctrl: true, key: "T" }] })).toEqual([
      { chord: "ctrl+t", ids: ["tab.new", "tab.close"] },
    ]);
  });

  it("reports global chords that shadow editor ones, but not editor-only pairs", () => {
    const list: Shortcut[] = [
      { id: "tab.new", label: "a", group: "Tabs", defaultBindings: [{ alt: true, key: "g" }] },
      { id: "editor.gotoLine", label: "b", group: "Editor", defaultBindings: [{ alt: true, key: "g" }] },
      { id: "editor.undo", label: "c", group: "Editor", defaultBindings: [{ alt: true, key: "u" }] },
      { id: "editor.redo", label: "d", group: "Editor", defaultBindings: [{ alt: true, key: "u" }] },
    ];
    expect(findShortcutConflicts(list)).toEqual([{ chord: "alt+g", ids: ["tab.new", "editor.gotoLine"] }]);
  });
});

describe("chordKey", () => {
  it("normalizes modifier order and key case", () => {
    expect(chordKey({ key: "K", shift: true, ctrl: true })).toBe("ctrl+shift+k");
  });
});
