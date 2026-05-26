import { IS_MAC, MOD_PROP } from "@/lib/platform";

/**
 * Single source of truth for keyboard shortcuts.
 */

export type ShortcutId =
  | "tab.new"
  | "tab.newPrivate"
  | "tab.newPreview"
  | "tab.newEditor"
  | "tab.close"
  | "tab.closeOthers"
  | "tab.next"
  | "tab.prev"
  | "tab.selectByIndex"
  | "pane.splitRight"
  | "pane.splitDown"
  | "pane.close"
  | "pane.focusNext"
  | "pane.focusPrev"
  | "pane.source"
  | "search.focus"
  | "explorer.search"
  | "explorer.focus"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.zoomReset"
  | "view.zenMode"
  | "ai.toggle"
  | "ai.askSelection"
  | "shortcuts.open"
  | "settings.open"
  | "sidebar.toggle"
  | "terminal.clear"
  | "editor.undo"
  | "editor.redo"
  | "editor.findReplace"
  | "editor.fold"
  | "editor.unfold"
  | "editor.toggleComment"
  | "editor.duplicateLine"
  | "editor.moveLineUp"
  | "editor.moveLineDown"
  | "editor.deleteLine"
  | "editor.gotoLine"
  | "editor.toggleWordWrap";

export type ShortcutGroup =
  | "General"
  | "Tabs"
  | "Panes"
  | "Search"
  | "AI"
  | "View"
  | "Editor";

export type KeyBinding = {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
};

export type Shortcut = {
  id: ShortcutId;
  label: string;
  group: ShortcutGroup;
  defaultBindings: KeyBinding[];
  allowRepeat?: boolean;
};

export const SHORTCUTS: Shortcut[] = [
  {
    id: "settings.open",
    label: "Open settings",
    group: "General",
    defaultBindings: [{ [MOD_PROP]: true, key: "," }],
  },
  {
    id: "shortcuts.open",
    label: "Show keyboard shortcuts",
    group: "General",
    defaultBindings: [{ [MOD_PROP]: true, key: "k" }],
  },
  {
    id: "tab.new",
    label: "New tab",
    group: "Tabs",
    defaultBindings: [{ [MOD_PROP]: true, key: "t" }],
  },
  {
    id: "tab.newPrivate",
    label: "New private terminal",
    group: "Tabs",
    defaultBindings: [{ [MOD_PROP]: true, key: "r" }],
  },
  {
    id: "tab.newPreview",
    label: "New preview tab",
    group: "Tabs",
    defaultBindings: [{ [MOD_PROP]: true, key: "p" }],
  },
  {
    id: "tab.newEditor",
    label: "New editor tab",
    group: "Tabs",
    defaultBindings: [{ [MOD_PROP]: true, key: "e" }],
  },
  {
    id: "tab.close",
    label: "Close tab or pane",
    group: "Tabs",
    defaultBindings: [{ [MOD_PROP]: true, key: "w" }],
  },
  {
    id: "pane.splitRight",
    label: "Split pane right",
    group: "Panes",
    defaultBindings: [{ [MOD_PROP]: true, key: "d" }],
  },
  {
    id: "pane.splitDown",
    label: "Split pane down",
    group: "Panes",
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "d" }],
  },
  {
    id: "pane.focusNext",
    label: "Focus next pane",
    group: "Panes",
    defaultBindings: [{ [MOD_PROP]: true, key: "]" }],
  },
  {
    id: "pane.focusPrev",
    label: "Focus previous pane",
    group: "Panes",
    defaultBindings: [{ [MOD_PROP]: true, key: "[" }],
  },  
  {
    id: "pane.source",
    label: "Toggle source panel",
    group: "Panes",
    defaultBindings: [{ [MOD_PROP]: true, key: "g" }],
  },
  {
    id: "tab.next",
    label: "Next tab",
    group: "Tabs",
    defaultBindings: [{ ctrl: true, key: "Tab" }],
  },
  {
    id: "tab.prev",
    label: "Previous tab",
    group: "Tabs",
    defaultBindings: [{ ctrl: true, shift: true, key: "Tab" }],
  },
  {
    id: "tab.selectByIndex",
    label: "Jump to tab 1–9",
    group: "Tabs",
    defaultBindings: [{ [MOD_PROP]: true, key: "1" }],
  },
  {
    id: "explorer.search",
    label: "Search files",
    group: "Search",
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "f" }],
  },
  {
    id: "search.focus",
    label: "Find in terminal",
    group: "Search",
    defaultBindings: [{ [MOD_PROP]: true, key: "f" }],
  },
  {
    id: "ai.toggle",
    label: "Toggle AI agent",
    group: "AI",
    defaultBindings: [{ [MOD_PROP]: true, key: "i" }],
  },
  {
    id: "ai.askSelection",
    label: "Ask AI about selection",
    group: "AI",
    defaultBindings: [{ [MOD_PROP]: true, key: "l" }],
  },
  {
    id: "sidebar.toggle",
    label: "Toggle file explorer",
    group: "View",
    defaultBindings: [{ [MOD_PROP]: true, key: "b" }],
  },
  {
    id: "explorer.focus",
    label: "Toggle file explorer focus",
    group: "View",
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "e" }],
  },
  {
    id: "view.zoomIn",
    label: "Zoom in",
    group: "View",
    defaultBindings: [
      { [MOD_PROP]: true, key: "=" },
      { [MOD_PROP]: true, shift: true, key: "+" },
    ],
    allowRepeat: true,
  },
  {
    id: "view.zoomOut",
    label: "Zoom out",
    group: "View",
    defaultBindings: [
      { [MOD_PROP]: true, key: "-" },
      { [MOD_PROP]: true, shift: true, key: "_" },
    ],
    allowRepeat: true,
  },
  {
    id: "view.zoomReset",
    label: "Reset zoom",
    group: "View",
    defaultBindings: [{ [MOD_PROP]: true, key: "0" }],
  },
  // Editor entries are display-only: CodeMirror's historyKeymap binds these
  // keys natively. We register them here so the shortcuts dialog can surface
  // them — they don't have App-level handlers, so `useGlobalShortcuts` falls
  // through without `preventDefault`, leaving CodeMirror to handle the event.
  // Also excluded from the customization UI in ShortcutsSection.
  {
    id: "editor.undo",
    label: "Undo",
    group: "Editor",
    defaultBindings: [{ [MOD_PROP]: true, key: "z" }],
  },
  {
    id: "editor.redo",
    label: "Redo",
    group: "Editor",
    defaultBindings: [{ [MOD_PROP]: true, key: "y" }],
  },
  {
    id: "editor.findReplace",
    label: "Find & Replace",
    group: "Editor",
    defaultBindings: [{ [MOD_PROP]: true, key: "h" }],
  },
  {
    id: "editor.fold",
    label: "Fold code",
    group: "Editor",
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "[" }],
  },
  {
    id: "editor.unfold",
    label: "Unfold code",
    group: "Editor",
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "]" }],
  },
  // --- Panes ---
  {
    id: "pane.close",
    label: "Close active pane",
    group: "Panes",
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "w" }],
  },
  // --- Tabs ---
  {
    id: "tab.closeOthers",
    label: "Close other tabs",
    group: "Tabs",
    defaultBindings: [],
  },
  // --- View ---
  {
    id: "view.zenMode",
    label: "Toggle zen mode",
    group: "View",
    defaultBindings: IS_MAC
      ? [{ meta: true, shift: true, key: "z" }]
      : [{ ctrl: true, shift: true, key: "z" }],
  },
  // --- Terminal ---
  {
    id: "terminal.clear",
    label: "Clear terminal",
    group: "General",
    defaultBindings: [{ ctrl: true, key: "k" }],
  },
  // --- Editor (display-only; CodeMirror handles these keys natively) ---
  {
    id: "editor.toggleComment",
    label: "Toggle line comment",
    group: "Editor",
    defaultBindings: [{ [MOD_PROP]: true, key: "/" }],
  },
  {
    id: "editor.duplicateLine",
    label: "Duplicate line",
    group: "Editor",
    defaultBindings: [{ shift: true, alt: true, key: "ArrowDown" }],
  },
  {
    id: "editor.moveLineUp",
    label: "Move line up",
    group: "Editor",
    defaultBindings: [{ alt: true, key: "ArrowUp" }],
    allowRepeat: true,
  },
  {
    id: "editor.moveLineDown",
    label: "Move line down",
    group: "Editor",
    defaultBindings: [{ alt: true, key: "ArrowDown" }],
    allowRepeat: true,
  },
  {
    id: "editor.deleteLine",
    label: "Delete line",
    group: "Editor",
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "k" }],
  },
  {
    id: "editor.gotoLine",
    label: "Go to line",
    group: "Editor",
    defaultBindings: [{ alt: true, key: "g" }],
  },
  {
    id: "editor.toggleWordWrap",
    label: "Toggle word wrap",
    group: "Editor",
    defaultBindings: [{ alt: true, key: "z" }],
  },
];

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  "General",
  "Tabs",
  "Panes",
  "View",
  "Search",
  "AI",
  "Editor",
];

/**
 * Returns a formatted shortcut display string for the given id, using its
 * first default binding. Returns "" if the id or binding is not found.
 */
export function shortcutDisplay(id: ShortcutId): string {
  const s = SHORTCUTS.find((s) => s.id === id);
  if (!s || s.defaultBindings.length === 0) return "";
  return getBindingTokens(s.defaultBindings[0]).join(IS_MAC ? "" : "+");
}

/**
 * Matching logic: checks if a KeyboardEvent matches a KeyBinding.
 */
export function matchBinding(
  e: KeyboardEvent,
  binding: KeyBinding,
  id?: ShortcutId
): boolean {
  const eventKey = e.key.toLowerCase();
  const bindingKey = binding.key.toLowerCase();

  // Special case for Jump to Tab 1-9
  if (id === "tab.selectByIndex") {
    if (!/^[1-9]$/.test(e.key)) return false;
  } else if (eventKey !== bindingKey) {
    return false;
  }

  return (
    !!e.ctrlKey === !!binding.ctrl &&
    !!e.shiftKey === !!binding.shift &&
    !!e.altKey === !!binding.alt &&
    !!e.metaKey === !!binding.meta
  );
}

/**
 * Display helpers
 */
export function getBindingTokens(binding?: KeyBinding): string[] {
  if (!binding) return [];
  const tokens: string[] = [];
  if (IS_MAC) {
    if (binding.ctrl) tokens.push("⌃");
    if (binding.alt) tokens.push("⌥");
    if (binding.shift) tokens.push("⇧");
    if (binding.meta) tokens.push("⌘");
  } else {
    if (binding.ctrl) tokens.push("Ctrl");
    if (binding.alt) tokens.push("Alt");
    if (binding.shift) tokens.push("Shift");
    if (binding.meta) tokens.push("Win");
  }

  let keyLabel = binding.key;
  if (keyLabel === " ") keyLabel = "Space";
  else if (keyLabel === "ArrowUp") keyLabel = "↑";
  else if (keyLabel === "ArrowDown") keyLabel = "↓";
  else if (keyLabel === "ArrowLeft") keyLabel = "←";
  else if (keyLabel === "ArrowRight") keyLabel = "→";
  else if (keyLabel.length === 1) keyLabel = keyLabel.toUpperCase();

  tokens.push(keyLabel);
  return tokens;
}
