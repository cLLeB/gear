import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  getBindingTokens,
  type KeyBinding,
  SHORTCUTS,
  type ShortcutId,
} from "../shortcuts";

const BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));

/** Resolve a shortcut's display tokens from a snapshot of user overrides.
 *  Pure — split out of the hook so the override-vs-default precedence can be
 *  tested without a React renderer. */
export function resolveShortcutLabel(
  overrides: Partial<Record<ShortcutId, KeyBinding[]>>,
  id: ShortcutId,
): string {
  const bindings = overrides[id] ?? BY_ID.get(id)?.defaultBindings;
  return getBindingTokens(bindings?.[0]).join(" ");
}

/** Display tokens for a shortcut's first binding, honoring user overrides. */
export function useShortcutLabel(id: ShortcutId): string {
  const user = usePreferencesStore((s) => s.shortcuts);
  return resolveShortcutLabel(user, id);
}
