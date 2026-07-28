import type { ShortcutId } from "@/modules/shortcuts/shortcuts";

function isPaneSwapShortcut(id: ShortcutId): boolean {
  return (
    id === "pane.swapLeft" ||
    id === "pane.swapRight" ||
    id === "pane.swapUp" ||
    id === "pane.swapDown"
  );
}

/**
 * Pane swaps bind Mod+Alt+Arrow, which the terminal and editor also use for
 * word/line navigation. With fewer than two panes a swap is a no-op, so the
 * binding is released back to whatever has focus instead of being swallowed.
 *
 * `terminalPaneCount` is null when the active tab isn't a terminal.
 */
export function shouldDisablePaneSwapShortcut(
  id: ShortcutId,
  terminalPaneCount: number | null,
): boolean {
  return (
    isPaneSwapShortcut(id) &&
    (terminalPaneCount === null || terminalPaneCount < 2)
  );
}
