// Detect key bindings claimed by more than one command. Global shortcuts are
// matched in declaration order and the first one wins, so a duplicate makes
// the later command silently unreachable — exactly the kind of bug a settings
// screen should surface (VS Code's keybinding conflict view).

import type { KeyBinding, Shortcut, ShortcutId } from "./shortcuts";

export interface ShortcutConflict {
  /** Normalized chord, e.g. "ctrl+shift+t". */
  chord: string;
  /** Commands bound to it, in match order; the first one wins. */
  ids: ShortcutId[];
}

export function chordKey(b: KeyBinding): string {
  const mods = [b.ctrl && "ctrl", b.alt && "alt", b.shift && "shift", b.meta && "meta"].filter(Boolean);
  return [...mods, b.key.toLowerCase()].join("+");
}

/**
 * Editor shortcuts are display-only: CodeMirror handles them, but only if no
 * global shortcut claims the chord first (global matching runs in the capture
 * phase). So an editor chord that equals a global one is shadowed — still a
 * conflict — while two editor chords never collide with each other's handler.
 */
function scopeOf(s: Shortcut): "editor" | "global" {
  return s.group === "Editor" ? "editor" : "global";
}

export function findShortcutConflicts(
  shortcuts: readonly Shortcut[],
  overrides: Partial<Record<ShortcutId, KeyBinding[]>> = {},
): ShortcutConflict[] {
  const byChord = new Map<string, ShortcutId[]>();
  for (const s of shortcuts) {
    if (s.id === "tab.selectByIndex") continue; // digit wildcard, matched specially
    const bindings = overrides[s.id] ?? s.defaultBindings;
    const seen = new Set<string>();
    for (const b of bindings) {
      const chord = chordKey(b);
      if (seen.has(chord)) continue;
      seen.add(chord);
      const list = byChord.get(chord) ?? [];
      list.push(s.id);
      byChord.set(chord, list);
    }
  }
  const scope = new Map(shortcuts.map((s) => [s.id, scopeOf(s)]));
  return [...byChord.entries()]
    .filter(([, ids]) => ids.length > 1 && ids.some((id) => scope.get(id) === "global"))
    .map(([chord, ids]) => ({ chord, ids }));
}
