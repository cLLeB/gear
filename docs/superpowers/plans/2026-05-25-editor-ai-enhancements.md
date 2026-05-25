# Editor & AI Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 13 zero-dependency editor, AI, layout, and terminal features to the Gear terminal app.

**Architecture:** Features fall into four groups — (1) editor keybindings wired directly into CodeMirror via `keymap.of` in `EditorPane.tsx`; (2) layout/UX state handled in `App.tsx` with persisted preferences in `store.ts`; (3) a UI extension to `SelectionAskAi.tsx`; and (4) a new tab context menu. Every feature uses packages already in the bundle — no new `npm install`.

**Tech Stack:** React 19, TypeScript, CodeMirror 6 (`@codemirror/commands`, `@codemirror/search`, `@codemirror/view`), Zustand, Tauri 2, shadcn/ui (Radix UI).

---

## File Map

| File | What changes |
|------|-------------|
| `src/modules/shortcuts/shortcuts.ts` | Add 11 new `ShortcutId` values + shortcut definitions |
| `src/modules/settings/store.ts` | Add `wordWrap` and `sidebarPosition` preferences |
| `src/modules/editor/lib/extensions.ts` | Init `wrapCompartment`, add `rectangularSelection` + `crosshairCursor` |
| `src/modules/editor/EditorPane.tsx` | Add editor keymaps + word wrap watcher |
| `src/modules/tabs/lib/useTabs.ts` | Add `closeOtherTabs` function |
| `src/modules/tabs/TabBar.tsx` | Add right-click context menu with "Close other tabs" |
| `src/modules/header/Header.tsx` | Add `onClosePane` / `canClosePane` props + button |
| `src/modules/ai/components/SelectionAskAi.tsx` | Replace single button with Explain / Refactor / Fix |
| `src/app/App.tsx` | Wire all new shortcut handlers, zen mode state, sidebar position, onAsk prefix |

---

## Task 1: Add new ShortcutIds and definitions

**Files:**
- Modify: `src/modules/shortcuts/shortcuts.ts`

- [ ] **Step 1: Extend the `ShortcutId` union type**

Open `src/modules/shortcuts/shortcuts.ts`. Find the `ShortcutId` type union (currently ends with `"editor.unfold"`). Replace the closing `;` with the new entries:

```typescript
export type ShortcutId =
  | "tab.new"
  | "tab.newPrivate"
  | "tab.newPreview"
  | "tab.newEditor"
  | "tab.close"
  | "tab.closeOthers"        // NEW
  | "tab.next"
  | "tab.prev"
  | "tab.selectByIndex"
  | "pane.splitRight"
  | "pane.splitDown"
  | "pane.close"             // NEW
  | "pane.focusNext"
  | "pane.focusPrev"
  | "pane.source"
  | "search.focus"
  | "explorer.search"
  | "explorer.focus"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.zoomReset"
  | "view.zenMode"           // NEW
  | "ai.toggle"
  | "ai.askSelection"
  | "shortcuts.open"
  | "settings.open"
  | "sidebar.toggle"
  | "terminal.clear"         // NEW
  | "editor.undo"
  | "editor.redo"
  | "editor.findReplace"
  | "editor.fold"
  | "editor.unfold"
  | "editor.toggleComment"   // NEW
  | "editor.duplicateLine"   // NEW
  | "editor.moveLineUp"      // NEW
  | "editor.moveLineDown"    // NEW
  | "editor.deleteLine"      // NEW
  | "editor.gotoLine"        // NEW
  | "editor.toggleWordWrap"; // NEW
```

- [ ] **Step 2: Add shortcut definitions to the SHORTCUTS array**

Find the closing `];` of the `SHORTCUTS` array. Insert before it:

```typescript
  // --- Pane ---
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
  // --- Editor (display-only; CodeMirror handles the actual keys) ---
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
```

- [ ] **Step 3: Verify TypeScript compiles**

```powershell
cd C:\Users\kyere\Documents\codes\gear
pnpm tsc --noEmit 2>&1 | Select-String "shortcuts"
```

Expected: no errors mentioning `shortcuts.ts`.

- [ ] **Step 4: Commit**

```powershell
git add src/modules/shortcuts/shortcuts.ts
git commit -m "feat: add shortcut IDs for pane close, zen mode, terminal clear, editor commands"
```

---

## Task 2: Editor keybindings — duplicateLine + display entries

**Files:**
- Modify: `src/modules/editor/EditorPane.tsx`

> **Context:** `toggleComment`, `moveLineUp`, `moveLineDown`, `deleteLine`, and `gotoLine` are already handled by CodeMirror's `defaultKeymap` / `searchKeymap` (included via `basicSetup`). We only need to explicitly register `duplicateLine` in the editor's keymap. All six are registered in the shortcuts dialog (Task 1) as display-only entries.

- [ ] **Step 1: Import `duplicateLine` at the top of EditorPane.tsx**

Find the existing import line:
```typescript
import { redo, undo } from "@codemirror/commands";
```
Replace it with:
```typescript
import { redo, undo, duplicateLine } from "@codemirror/commands";
```

- [ ] **Step 2: Add `duplicateLine` to the keymap in the `useMemo` extensions array**

Find the `keymap.of([...])` block inside the `useMemo` that currently contains only the `Mod-s` save binding:

```typescript
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              void (async () => {
                await saveRef.current();
                onSavedRef.current?.();
              })();
              return true;
            },
          },
        ]),
```

Replace with:

```typescript
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              void (async () => {
                await saveRef.current();
                onSavedRef.current?.();
              })();
              return true;
            },
          },
          { key: "Shift-Alt-ArrowDown", run: duplicateLine },
        ]),
```

- [ ] **Step 3: Verify TypeScript compiles**

```powershell
pnpm tsc --noEmit 2>&1 | Select-String "EditorPane"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```powershell
git add src/modules/editor/EditorPane.tsx
git commit -m "feat: add duplicate-line keybinding to code editor"
```

---

## Task 3: Word wrap toggle — preference + wiring

**Files:**
- Modify: `src/modules/settings/store.ts`
- Modify: `src/modules/editor/lib/extensions.ts`
- Modify: `src/modules/editor/EditorPane.tsx`
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Add `wordWrap` to the `Preferences` type in store.ts**

Find the end of the `Preferences` type (the line `shortcuts: Record<ShortcutId, KeyBinding[]>;`). Add before it:

```typescript
  wordWrap: boolean;
```

- [ ] **Step 2: Add storage key and default in store.ts**

Find `const KEY_VIM_MODE = "vimMode";` and add after it:
```typescript
const KEY_WORD_WRAP = "wordWrap";
```

Find `vimMode: false,` in `DEFAULT_PREFERENCES` and add after it:
```typescript
  wordWrap: false,
```

- [ ] **Step 3: Load `wordWrap` in `loadPreferences` in store.ts**

Find:
```typescript
    vimMode: get<boolean>(KEY_VIM_MODE) ?? DEFAULT_PREFERENCES.vimMode,
```
Add after it:
```typescript
    wordWrap: get<boolean>(KEY_WORD_WRAP) ?? DEFAULT_PREFERENCES.wordWrap,
```

- [ ] **Step 4: Add setter function in store.ts**

Find `export async function setVimMode(value: boolean): Promise<void> {` and add after its closing brace:

```typescript
export async function setWordWrap(value: boolean): Promise<void> {
  await writePref(KEY_WORD_WRAP, value);
}
```

- [ ] **Step 5: Register in the onChange key map in store.ts**

Find `[KEY_VIM_MODE]: "vimMode",` in the key→preference map inside `onPreferencesChange`. Add after it:

```typescript
    [KEY_WORD_WRAP]: "wordWrap",
```

- [ ] **Step 6: Initialize `wrapCompartment` in extensions.ts**

Open `src/modules/editor/lib/extensions.ts`. The function `buildSharedExtensions()` returns an array. Find the closing `]` of that return array and add `wrapCompartment.of([])` as the last element:

```typescript
export function buildSharedExtensions(): Extension[] {
  return [
    indentUnit.of("  "),
    EditorState.tabSize.of(2),
    codeFolding(),
    search({ top: true }),
    lintGutter(),
    wrapCompartment.of([]),   // ← ADD THIS LINE
    EditorView.theme({ ... }),
  ];
}
```

- [ ] **Step 7: Import `EditorView` in EditorPane.tsx and wire the wrapCompartment**

Find the imports in `EditorPane.tsx`. Add `EditorView` to the `@codemirror/view` import and `wrapCompartment` to the extensions import:

```typescript
import { keymap, EditorView } from "@codemirror/view";
```

```typescript
import {
  buildSharedExtensions,
  languageCompartment,
  vimCompartment,
  wrapCompartment,         // ← ADD
} from "./lib/extensions";
```

- [ ] **Step 8: Read `wordWrap` preference and add a reconfigure effect in EditorPane.tsx**

Find the `vimMode` preference read:
```typescript
const vimMode = usePreferencesStore((s) => s.vimMode);
```
Add after it:
```typescript
const wordWrap = usePreferencesStore((s) => s.wordWrap);
```

Find the `useEffect` that reconfigures `vimCompartment`. Add a parallel effect after it:

```typescript
useEffect(() => {
  const view = cmRef.current?.view;
  if (!view) return;
  view.dispatch({
    effects: wrapCompartment.reconfigure(
      wordWrap ? EditorView.lineWrapping : [],
    ),
  });
}, [wordWrap]);
```

- [ ] **Step 9: Wire `editor.toggleWordWrap` shortcut handler in App.tsx**

In `App.tsx`, import `setWordWrap` alongside the other settings imports:
```typescript
import {
  ...
  setWordWrap,
} from "@/modules/settings/store";
```

Read the preference value near the other preference reads:
```typescript
const wordWrap = usePreferencesStore((s) => s.wordWrap);
```

In the `shortcutHandlers` useMemo, add after `"editor.findReplace"`:
```typescript
      "editor.toggleWordWrap": () => void setWordWrap(!wordWrap),
```

Add `wordWrap` to the `shortcutHandlers` dependency array.

- [ ] **Step 10: Verify TypeScript compiles**

```powershell
pnpm tsc --noEmit 2>&1 | Select-String "wordWrap|wrapCompartment|store"
```

Expected: no errors.

- [ ] **Step 11: Commit**

```powershell
git add src/modules/settings/store.ts src/modules/editor/lib/extensions.ts src/modules/editor/EditorPane.tsx src/app/App.tsx
git commit -m "feat: add word wrap toggle to code editor"
```

---

## Task 4: Column / rectangular selection

**Files:**
- Modify: `src/modules/editor/lib/extensions.ts`

- [ ] **Step 1: Import `rectangularSelection` and `crosshairCursor` in extensions.ts**

Find the existing view import in `extensions.ts`:
```typescript
import { EditorView } from "@codemirror/view";
```
Replace with:
```typescript
import { EditorView, rectangularSelection, crosshairCursor } from "@codemirror/view";
```

- [ ] **Step 2: Add to `buildSharedExtensions()` return array**

After `wrapCompartment.of([]),` add:
```typescript
    rectangularSelection(),
    crosshairCursor(),
```

- [ ] **Step 3: Verify and commit**

```powershell
pnpm tsc --noEmit 2>&1 | Select-String "extensions"
git add src/modules/editor/lib/extensions.ts
git commit -m "feat: enable rectangular/column selection in code editor (Alt+drag)"
```

---

## Task 5: Unsplit pane — shortcut + close-pane button in Header

**Files:**
- Modify: `src/modules/header/Header.tsx`
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Add `onClosePane` and `canClosePane` props to Header.tsx**

Find the `Props` type in `src/modules/header/Header.tsx`. Add two properties after `canSplit`:

```typescript
  onClosePane: () => void;
  /** Active terminal tab has more than one pane. */
  canClosePane: boolean;
```

Add them to the destructured parameters of `Header`:
```typescript
export function Header({
  ...
  onSplit,
  canSplit,
  onClosePane,   // ← ADD
  canClosePane,  // ← ADD
  ...
```

- [ ] **Step 2: Render the "Close pane" button in Header.tsx**

Find the split `DropdownMenu` block that ends with `</DropdownMenu>`. Add a new button directly after it:

```tsx
        {canClosePane && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Close pane (Ctrl+Shift+W)"
            onClick={onClosePane}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={1.75} />
          </Button>
        )}
```

> `Cancel01Icon` is already imported in Header.tsx (used in the close tab button).

- [ ] **Step 3: Wire `pane.close` shortcut and pass new props in App.tsx**

In the `shortcutHandlers` useMemo, add after `"pane.source"`:
```typescript
      "pane.close": () => {
        const t = tabsRef.current.find((x) => x.id === activeId);
        if (t?.kind === "terminal" && leafIds(t.paneTree).length > 1) {
          closeActivePane(activeId);
        }
      },
```

Add `closeActivePane` to the dependency array if not already present.

Find the `<Header` JSX in App.tsx (around line 1325). Add two props:
```tsx
            onClosePane={() => closeActivePane(activeId)}
            canClosePane={
              activeTerminalTab !== null &&
              leafIds(activeTerminalTab.paneTree).length > 1
            }
```

- [ ] **Step 4: Verify TypeScript compiles**

```powershell
pnpm tsc --noEmit 2>&1 | Select-String "Header|pane"
```

Expected: no errors.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/header/Header.tsx src/app/App.tsx
git commit -m "feat: add unsplit pane shortcut (Ctrl+Shift+W) and close-pane button"
```

---

## Task 6: Close other tabs

**Files:**
- Modify: `src/modules/tabs/lib/useTabs.ts`
- Modify: `src/modules/tabs/TabBar.tsx`
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Add `closeOtherTabs` to useTabs.ts**

Find `const closeTab = useCallback(...)` in `src/modules/tabs/lib/useTabs.ts`. Add a new function directly after its closing `}, []);`:

```typescript
  const closeOtherTabs = useCallback((keepId: number): void => {
    let toDispose: number[] = [];
    setTabs((curr) => {
      const keep = curr.find((t) => t.id === keepId);
      if (!keep || curr.length <= 1) return curr;
      for (const t of curr) {
        if (t.id !== keepId && t.kind === "terminal") {
          toDispose.push(...leafIds(t.paneTree));
        }
      }
      return [keep];
    });
    setActiveId(keepId);
    for (const lid of toDispose) disposeSession(lid);
  }, []);
```

- [ ] **Step 2: Add `closeOtherTabs` to the return value of useTabs**

Find the return object of `useTabs`. Add `closeOtherTabs,` after `closeTab,`:

```typescript
    closeTab,
    closeOtherTabs,   // ← ADD
```

- [ ] **Step 3: Add `onCloseOthers` prop to TabBar.tsx and wrap tabs with ContextMenu**

Open `src/modules/tabs/TabBar.tsx`. Add to the `Props` type:
```typescript
  onCloseOthers?: (id: number) => void;
```

Add to the destructured parameters:
```typescript
  onCloseOthers,
```

Add the import for ContextMenu at the top of the file:
```typescript
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
```

Find `return (` inside the `tabs.map(...)` call. Wrap the `<TabsTrigger ...>` element with a `ContextMenu`:

```tsx
              return (
                <ContextMenu key={t.id}>
                  <ContextMenuTrigger asChild>
                    <TabsTrigger
                      value={String(t.id)}
                      data-tab-id={t.id}
                      {/* ...all existing props unchanged... */}
                    >
                      {/* ...existing children unchanged... */}
                    </TabsTrigger>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="min-w-44">
                    <ContextMenuItem
                      onSelect={() => onCloseOthers?.(t.id)}
                      disabled={tabs.length <= 1}
                    >
                      Close other tabs
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
```

> Important: remove the `key={t.id}` from `TabsTrigger` (it moves to `ContextMenu`).

- [ ] **Step 4: Wire `closeOtherTabs` and pass `onCloseOthers` in App.tsx**

Destructure `closeOtherTabs` from `useTabs()`:
```typescript
const { ..., closeOtherTabs } = useTabs(...);
```

Find the `<TabBar` JSX (inside `<Header>`). The `TabBar` props are passed through `Header`. Instead of threading through Header, find where `TabBar` is rendered directly — or if Header renders it internally, add the prop to `Header` and forward to `TabBar`.

Check `Header.tsx`: if it renders `TabBar` internally, add `onCloseOthers` to Header props and forward it. If TabBar is rendered directly in App.tsx, add directly.

Looking at existing code — `Header` contains `TabBar`. So:

In `Header.tsx` Props type, add:
```typescript
  onCloseOthers: (id: number) => void;
```

In `Header` function parameters, add `onCloseOthers`. Forward to `<TabBar onCloseOthers={onCloseOthers} .../>`.

In `App.tsx`, pass to `<Header>`:
```tsx
            onCloseOthers={closeOtherTabs}
```

- [ ] **Step 5: Verify TypeScript compiles**

```powershell
pnpm tsc --noEmit 2>&1 | Select-String "TabBar|closeOther|Header"
```

Expected: no errors.

- [ ] **Step 6: Commit**

```powershell
git add src/modules/tabs/lib/useTabs.ts src/modules/tabs/TabBar.tsx src/modules/header/Header.tsx src/app/App.tsx
git commit -m "feat: add close-other-tabs via right-click context menu"
```

---

## Task 7: AI selection presets — Explain / Refactor / Fix

**Files:**
- Modify: `src/modules/ai/components/SelectionAskAi.tsx`
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Update `SelectionAskAiProps` and the component in SelectionAskAi.tsx**

Replace the entire file content with:

```typescript
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";
import { motion } from "motion/react";
import { useEffect } from "react";

export type SelectionAskAiProps = {
  x: number;
  y: number;
  onAsk: (prefix: string) => void;
  onDismiss: () => void;
};

const W = 240;
const OFFSET = 36;

const PRESETS: { label: string; prefix: string }[] = [
  { label: "Explain", prefix: "Explain this code:\n" },
  { label: "Refactor", prefix: "Refactor this code:\n" },
  { label: "Fix", prefix: "Fix this code:\n" },
];

export function SelectionAskAi({ x, y, onAsk, onDismiss }: SelectionAskAiProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const top = Math.max(8, y - OFFSET);
  const left = Math.max(8, Math.min(x - W / 2, window.innerWidth - W - 8));

  return (
    <motion.div
      data-selection-ask-ai
      initial={{ opacity: 0, y: 4, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.95 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      style={{ top, left, width: W }}
      className="fixed z-50 flex gap-1 rounded-md border border-border/60 bg-card/95 p-1 shadow-lg backdrop-blur-md"
    >
      {PRESETS.map(({ label, prefix }) => (
        <button
          key={label}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAsk(prefix);
          }}
          className="flex flex-1 items-center justify-center rounded px-2 py-1 text-xs hover:bg-accent"
        >
          {label}
        </button>
      ))}
      <div className="flex items-center gap-1 border-l border-border/60 pl-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAsk("");
          }}
          className="flex h-6 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <KbdGroup>
            <Kbd className="h-4 min-w-4 px-1 text-[10px]">{fmtShortcut(MOD_KEY, "L")}</Kbd>
          </KbdGroup>
        </button>
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Update the `onAsk` call site in App.tsx**

Search App.tsx for where `<SelectionAskAi` is rendered (around line 1452). Find the `onAsk` prop — it currently calls `onAsk={() => askFromSelection()}` or similar.

Update it to pass prefix to `askFromSelection`:
```tsx
<SelectionAskAi
  ...
  onAsk={(prefix) => askFromSelection(prefix)}
  ...
/>
```

Then find the `askFromSelection` function in App.tsx. It currently constructs a message from the terminal selection. Update it to accept and prepend the prefix:

```typescript
// Find the existing askFromSelection definition. It looks roughly like:
const askFromSelection = useCallback(() => {
  const selection = /* some selection string */;
  // opens panel and sends selection
}, [...]);

// Change the signature and prepend the prefix:
const askFromSelection = useCallback((prefix = "") => {
  const selection = /* same selection logic */;
  const message = prefix ? `${prefix}${selection}` : selection;
  // use message instead of selection
}, [...]);
```

> **Note:** read the actual `askFromSelection` implementation in App.tsx (search for it) and make the minimal change — only add the `prefix = ""` parameter and prepend it to whatever string gets sent.

- [ ] **Step 3: Verify TypeScript compiles**

```powershell
pnpm tsc --noEmit 2>&1 | Select-String "SelectionAskAi|askFromSelection"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```powershell
git add src/modules/ai/components/SelectionAskAi.tsx src/app/App.tsx
git commit -m "feat: add Explain/Refactor/Fix quick-action presets to AI selection popup"
```

---

## Task 8: Sidebar position toggle

**Files:**
- Modify: `src/modules/settings/store.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/modules/sidebar/SidebarRail.tsx`

- [ ] **Step 1: Add `sidebarPosition` to the `Preferences` type in store.ts**

Add to the `Preferences` type:
```typescript
  sidebarPosition: "left" | "right";
```

Add the storage key constant near the other key constants:
```typescript
const KEY_SIDEBAR_POSITION = "sidebarPosition";
```

Add to `DEFAULT_PREFERENCES`:
```typescript
  sidebarPosition: "left",
```

Add to `loadPreferences` (find `vimMode:` and add nearby):
```typescript
    sidebarPosition:
      (get<string>(KEY_SIDEBAR_POSITION) as "left" | "right") ?? "left",
```

Add the setter function:
```typescript
export async function setSidebarPosition(value: "left" | "right"): Promise<void> {
  await writePref(KEY_SIDEBAR_POSITION, value);
}
```

Add to the onChange key map:
```typescript
    [KEY_SIDEBAR_POSITION]: "sidebarPosition",
```

- [ ] **Step 2: Swap panel order in App.tsx based on `sidebarPosition`**

In `App.tsx`, import `setSidebarPosition` from the settings store:
```typescript
import { ..., setSidebarPosition } from "@/modules/settings/store";
```

Read the preference:
```typescript
const sidebarPosition = usePreferencesStore((s) => s.sidebarPosition);
```

Find the `ResizablePanelGroup` containing `id="sidebar"` and `id="workspace"` panels. Extract each panel into variables and conditionally order them:

```tsx
const sidebarPanel = (
  <ResizablePanel
    id="sidebar"
    panelRef={sidebarRef}
    defaultSize={`${sidebarWidthRef.current}px`}
    minSize={`${SIDEBAR_MIN_WIDTH}px`}
    maxSize={`${SIDEBAR_MAX_WIDTH}px`}
    collapsible
    collapsedSize={0}
    onResize={(size) => {
      if (size.inPixels > 0) persistSidebarWidth(size.inPixels);
    }}
  >
    <div className={cn(
      "flex h-full min-h-0 flex-col bg-card",
      sidebarPosition === "left" ? "border-r border-border" : "border-l border-border",
    )}>
      <SidebarRail ... />
      <div className="min-h-0 flex-1">...</div>
    </div>
  </ResizablePanel>
);

const workspacePanel = (
  <ResizablePanel id="workspace" defaultSize="78%" minSize="30%">
    ...existing content...
  </ResizablePanel>
);
```

Then render:
```tsx
<ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
  {sidebarPosition === "left" ? (
    <>
      {sidebarPanel}
      <ResizableHandle withHandle />
      {workspacePanel}
    </>
  ) : (
    <>
      {workspacePanel}
      <ResizableHandle withHandle />
      {sidebarPanel}
    </>
  )}
</ResizablePanelGroup>
```

- [ ] **Step 3: Add a toggle button to SidebarRail.tsx**

Open `src/modules/sidebar/SidebarRail.tsx`. Add a prop:
```typescript
type Props = {
  activeView: SidebarViewId;
  onSelectView: (view: SidebarViewId) => void;
  changedCount: number;
  sidebarPosition: "left" | "right";          // ← ADD
  onToggleSidebarPosition: () => void;         // ← ADD
};
```

Add a small icon button at the bottom of the rail (below the existing view buttons):
```tsx
<button
  type="button"
  title={sidebarPosition === "left" ? "Move sidebar to right" : "Move sidebar to left"}
  onClick={onToggleSidebarPosition}
  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
>
  {/* Use an appropriate HugeiconsIcon — SidebarRight or similar */}
  <HugeiconsIcon
    icon={sidebarPosition === "left" ? SidebarRightIcon : SidebarLeftIcon}
    size={16}
    strokeWidth={1.75}
  />
</button>
```

> Look at the existing icon imports in `SidebarRail.tsx` to pick a matching icon name. If `SidebarRightIcon` doesn't exist, use `LayoutLeftIcon` / `LayoutRightIcon` or any directional icon already imported nearby.

- [ ] **Step 4: Pass new props from App.tsx to SidebarRail**

In App.tsx, pass to `<SidebarRail>`:
```tsx
<SidebarRail
  activeView={sidebarView}
  onSelectView={persistSidebarView}
  changedCount={sourceControl.changedCount}
  sidebarPosition={sidebarPosition}
  onToggleSidebarPosition={() =>
    void setSidebarPosition(sidebarPosition === "left" ? "right" : "left")
  }
/>
```

- [ ] **Step 5: Verify TypeScript compiles**

```powershell
pnpm tsc --noEmit 2>&1 | Select-String "sidebar|SidebarRail|sidebarPosition"
```

Expected: no errors.

- [ ] **Step 6: Commit**

```powershell
git add src/modules/settings/store.ts src/modules/sidebar/SidebarRail.tsx src/app/App.tsx
git commit -m "feat: add sidebar position toggle (left/right) with persistent preference"
```

---

## Task 9: Clear terminal shortcut

**Files:**
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Add `terminal.clear` handler to shortcutHandlers in App.tsx**

In the `shortcutHandlers` useMemo, add after `"sidebar.toggle"`:

```typescript
      "terminal.clear": () => {
        if (activeLeafId === null) return;
        terminalRefs.current.get(activeLeafId)?.write("clear\n");
      },
```

> `activeLeafId` and `terminalRefs` are already in scope in App.tsx.
> `terminalRefs.current.get(activeLeafId)` returns a `TerminalPaneHandle` whose `write(data: string)` method sends bytes directly to the pty.

- [ ] **Step 2: Verify TypeScript compiles**

```powershell
pnpm tsc --noEmit 2>&1 | Select-String "terminal.clear|terminalRefs"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```powershell
git add src/app/App.tsx
git commit -m "feat: add Ctrl+K shortcut to clear active terminal"
```

---

## Task 10: Zen mode

**Files:**
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Add `zenMode` state to App.tsx**

Find the block of `useState` declarations near the top of the `App` function. Add:

```typescript
const [zenMode, setZenMode] = useState(false);
```

- [ ] **Step 2: Add `view.zenMode` to shortcutHandlers**

In the `shortcutHandlers` useMemo, add after `"view.zoomReset"`:

```typescript
      "view.zenMode": () => setZenMode((v) => !v),
```

Add `setZenMode` to the dependency array.

- [ ] **Step 3: Conditionally hide header, status bar, and sidebar in App.tsx**

Find `<Header` JSX. Wrap it:
```tsx
{!zenMode && (
  <Header ... />
)}
```

Find `<StatusBar` JSX. Wrap it:
```tsx
{!zenMode && (
  <StatusBar ... />
)}
```

Find the sidebar `ResizablePanel`. When zen mode is active, render only the workspace panel:
```tsx
<ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
  {zenMode ? (
    <ResizablePanel id="workspace" defaultSize="100%" minSize="30%">
      ...workspace content...
    </ResizablePanel>
  ) : sidebarPosition === "left" ? (
    <>
      {sidebarPanel}
      <ResizableHandle withHandle />
      {workspacePanel}
    </>
  ) : (
    <>
      {workspacePanel}
      <ResizableHandle withHandle />
      {sidebarPanel}
    </>
  )}
</ResizablePanelGroup>
```

- [ ] **Step 4: Add a brief zen-mode hint overlay**

Inside the workspace content area, add (using `motion` from `motion/react`):

```tsx
{zenMode && (
  <ZenModeHint onExit={() => setZenMode(false)} />
)}
```

Create a small inline component (or add inline JSX) that auto-hides after 2 s:

```tsx
function ZenModeHint({ onExit }: { onExit: () => void }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 2000);
    return () => clearTimeout(t);
  }, []);
  if (!visible) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md border border-border/60 bg-card/80 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm"
    >
      Press Ctrl+Shift+Z to exit zen mode
    </motion.div>
  );
}
```

Place `ZenModeHint` definition at the bottom of `App.tsx` (outside the `App` function, inside the file).

- [ ] **Step 5: Verify TypeScript compiles**

```powershell
pnpm tsc --noEmit 2>&1 | Select-String "zenMode|ZenModeHint"
```

Expected: no errors.

- [ ] **Step 6: Commit**

```powershell
git add src/app/App.tsx
git commit -m "feat: add zen mode (Ctrl+Shift+Z) hiding header, sidebar, and status bar"
```

---

## Self-Review Notes

- **Spec coverage:** All 13 features covered across Tasks 1–10.  
- **`askFromSelection` in Task 7:** The plan says "find the actual implementation and make the minimal change." The function is in App.tsx around line 763 — it sends text to the chat panel. The prefix prepend is the only change.  
- **`SidebarRightIcon` in Task 8:** The exact icon name depends on what's available in `@hugeicons/react`. Check existing imports in `Header.tsx` or `SidebarRail.tsx` and use the closest match.  
- **`ZenModeHint` in Task 10:** Can be a local component inside `App.tsx` or extracted to `src/components/ZenModeHint.tsx` — inline is fine given it's small.
- **`tab.closeOthers` shortcut:** Registered in Task 1 with empty `defaultBindings` (menu-only). This is intentional.
