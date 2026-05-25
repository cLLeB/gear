# Editor & AI Enhancements — Design Spec
**Date:** 2026-05-25  
**Constraint:** Zero new npm dependencies. All features use packages already in the bundle.

---

## 1. Scope

13 features grouped into four areas:

| Area | Features |
|------|----------|
| Pane / layout | Unsplit pane, sidebar position toggle, zen mode |
| Editor commands | Toggle comment, duplicate line, move line up/down, delete line, go to line, word wrap toggle, column selection |
| AI enhancements | AI selection presets (Explain / Refactor / Fix) |
| Terminal | Clear terminal shortcut |
| Tab management | Close other tabs |

---

## 2. Pane / Layout

### 2a. Unsplit pane (`pane.close`)

**What:** Close the active terminal split pane and return to a single pane. If only one pane exists, this is a no-op.

**How:**
- Add `"pane.close"` to `ShortcutId` union in `shortcuts.ts`.
- Register default binding `Ctrl+Shift+W` (mac: `Cmd+Shift+W`) in the shortcuts definition list alongside `pane.splitRight` / `pane.splitDown`.
- Wire to `closeActivePane(activeId)` in `App.tsx` shortcut handlers map.
- The `closeActivePane` function already exists in `useTabs.ts` — no logic changes needed.
- Show a "Close pane" button (×) in the terminal header when `leafIds(paneTree).length > 1`. Button calls the same handler.

**Files:** `shortcuts.ts`, `App.tsx`, terminal header component.

---

### 2b. Sidebar position toggle

**What:** Persist a user preference to place the file explorer / source control rail on the right side of the window instead of the left.

**How:**
- Add `sidebarPosition: "left" | "right"` to `Preferences` type in `store.ts` with default `"left"`, storage key `"sidebarPosition"`, and matching `loadPreferences` / `savePreference` wiring.
- In `App.tsx`, read `sidebarPosition` from `usePreferencesStore`. Conditionally swap the order of `ResizablePanel id="sidebar"` and `ResizablePanel id="workspace"` and flip `border-r` ↔ `border-l` on the sidebar container div.
- Add a toggle button in the sidebar rail footer (or settings page) that calls `savePreference("sidebarPosition", ...)`.

**Files:** `store.ts`, `App.tsx`, `SidebarRail.tsx` (or settings page).

---

### 2c. Zen mode (`view.zenMode`)

**What:** Hide the sidebar, status bar, and tab bar to provide a distraction-free full-screen editing experience. Toggle on/off.

**How:**
- Add ephemeral React state `zenMode: boolean` in `App.tsx` (not persisted — resets on relaunch, intentional).
- Add `"view.zenMode"` to `ShortcutId` and register default `Ctrl+Shift+Z` (mac: `Cmd+Shift+Z`).
- When `zenMode` is true: render `null` for `<Header>`, `<StatusBar>`, and the sidebar `ResizablePanel`; force `workspace` panel to fill 100%.
- A small floating escape hint ("Press Ctrl+Shift+Z to exit zen mode") fades in via `motion.div` for 2 s then disappears.

**Files:** `shortcuts.ts`, `App.tsx`.

---

## 3. Editor Commands

All commands come from `@codemirror/commands` or `@codemirror/search` (both already in `package.json`). Implementation pattern is the same for each:

1. Import the command function.
2. Add a `keymap.of([{ key: "...", run: command }])` entry in the `useMemo` extensions array inside `EditorPane.tsx`.
3. Add a `ShortcutId` entry + shortcut definition so the command appears in the shortcuts dialog.

| ShortcutId | Default key | CM function | Source |
|---|---|---|---|
| `editor.toggleComment` | Ctrl+/ | `toggleComment` | `@codemirror/commands` |
| `editor.duplicateLine` | Shift+Alt+↓ | `duplicateLine` | `@codemirror/commands` |
| `editor.moveLineUp` | Alt+↑ | `moveLineUp` | `@codemirror/commands` |
| `editor.moveLineDown` | Alt+↓ | `moveLineDown` | `@codemirror/commands` |
| `editor.deleteLine` | Ctrl+Shift+K | `deleteLine` | `@codemirror/commands` |
| `editor.gotoLine` | Ctrl+G | `gotoLine` | `@codemirror/search` |

### Word wrap toggle (`editor.toggleWordWrap`)

- `wrapCompartment` is already declared in `extensions.ts` but never used.
- Add `wrapCompartment.of([])` to the `buildSharedExtensions()` return array.
- Add a `wordWrap: boolean` preference (default `false`) to the preferences store.
- In `EditorPane.tsx`, watch `wordWrap` and dispatch `wrapCompartment.reconfigure(wordWrap ? EditorView.lineWrapping : [])` — same pattern as `vimCompartment`.
- Add `"editor.toggleWordWrap"` shortcut (Alt+Z).
- Add a word-wrap button in the editor toolbar / status area.

**Files:** `store.ts`, `extensions.ts`, `EditorPane.tsx`, `shortcuts.ts`.

### Column / rectangular selection

- Add `rectangularSelection()` and `crosshairCursor()` from `@codemirror/view` to `buildSharedExtensions()`.
- No shortcut needed — activated by Alt+drag (built-in CM behavior).
- Both symbols are already tree-shaken into the bundle via `@codemirror/view`.

**Files:** `extensions.ts`.

---

## 4. AI Enhancements

### AI selection presets (Explain / Refactor / Fix)

**What:** When text is selected in the terminal and the "Ask Gear" popup appears, show three quick-action buttons instead of one generic button.

**How:**
- Change `SelectionAskAi.tsx` `onAsk` prop signature from `() => void` to `(prefix: string) => void`.
- Render three buttons: **Explain**, **Refactor**, **Fix** — each passes a prefix string (`"Explain this code:\n"`, `"Refactor this code:\n"`, `"Fix this code:\n"`).
- Widen the popup from `W=110` to `W=220` to fit three buttons side-by-side.
- Update call-site in `App.tsx` where `onAsk` is wired to prepend the prefix to the selected text before sending.

**Files:** `SelectionAskAi.tsx`, `App.tsx` (onAsk handler).

---

## 5. Terminal — Clear terminal (`terminal.clear`)

**What:** Keyboard shortcut to clear the active terminal pane output.

**How:**
- Add `"terminal.clear"` to `ShortcutId` and register default `Ctrl+K`.
- In `App.tsx` shortcut handlers, find the active terminal leaf and send the string `"clear\n"` (or the platform equivalent) via the existing `TerminalPaneHandle` write method.
- Guard: only fires when a terminal tab is active (not editor/preview/etc.).

**Files:** `shortcuts.ts`, `App.tsx`, potentially `TerminalStack` / `TerminalPaneHandle` if a `write` method needs exposing.

---

## 6. Tab Management — Close other tabs (`tab.closeOthers`)

**What:** Close all tabs except the currently active one. Available via right-click context menu on a tab.

**How:**
- Add `closeOtherTabs(keepId: number)` to `useTabs.ts`: filters `tabs` to only the tab matching `keepId`, disposes terminal sessions for all removed tabs.
- Expose it from `useTabs` return value.
- Add a "Close other tabs" item to the tab context menu in `TabBar.tsx`.
- Add `"tab.closeOthers"` to `ShortcutId` (no default key binding — menu-only for now).

**Files:** `useTabs.ts`, `TabBar.tsx`, `shortcuts.ts`.

---

## 7. Implementation Order

1. Editor commands (6 keybindings + word wrap + column selection) — isolated, low risk
2. Unsplit pane — exposes existing logic
3. Close other tabs — pure state logic
4. AI selection presets — contained UI change
5. Sidebar position toggle — layout change, test carefully
6. Clear terminal — needs IPC surface check
7. Zen mode — integrates with multiple layout elements, do last

---

## 8. Out of Scope

- Auto-close brackets — **already enabled** (`closeBrackets: true` in basicSetup)
- AI commit message generation — **already shipped** (`scm.generateCommitMessage()`)
- No new npm packages
- No build size increase beyond trivial JS for new components
