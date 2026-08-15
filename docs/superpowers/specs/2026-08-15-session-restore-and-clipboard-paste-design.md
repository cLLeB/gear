# Session Restore & Explorer Clipboard Paste — Design

Date: 2026-08-15
Branch: `feat/upstream-sync-0.8.7`

## Goals

1. **Explorer paste** — paste files/folders into a directory from the sidebar tree,
   in every form: from the OS clipboard (Windows Explorer / Finder / Nautilus),
   from an in-app copy/cut of tree rows, and from raw clipboard text or an image
   (which becomes a new file).
2. **Session restore** — closing Gear with many tabs open and reopening it brings
   everything back exactly as it was: same tabs, same order, same active tab,
   same terminal split layout, same editor cursor/scroll, same unsaved edits.
3. **Fresh launch opens a terminal** — a first-ever launch (or one with no saved
   state) opens a terminal at the workspace root, never an `untitled` editor.

## Current state (what the investigation found)

Three overlapping persistence layers exist. Only the weakest one runs.

| Layer | Location | Status |
|---|---|---|
| Legacy localStorage | `src/modules/terminal/lib/sessionPersistence.ts` + `App.tsx:237-332` | **Active.** Saves terminal `{title, cwd, spaceId}` and editor paths only. |
| Spaces meta localStorage | `saveSpacesMeta`/`loadSpacesMeta`, `App.tsx:489-530` | **Active.** Space list + active id only, no tabs. |
| Spaces store (Tauri file) | `src/modules/spaces/lib/{serialize,store,useSpacesBoot,useSpacePersistence}.ts` | **Dead code.** Complete and unit-tested, exported from `index.ts`, never called. |

Consequences visible to the user:

- `useTabs.ts:215` seeds state with a hardcoded `untitled` editor tab. Because of
  it, `App.tsx:290` restores `sessions.slice(1)` — the first terminal is
  *deliberately dropped* to make room for the untitled tab. This is bug #3.
- Editor tabs are appended after all terminals, so tab order is not preserved.
- Active tab, terminal split panes, and `markdown`/`preview`/`settings`/
  `git-history` tabs are not persisted at all.

The fix for goals 2 and 3 is therefore mostly **wiring the subsystem that already
exists** and deleting the legacy path, not writing new persistence from scratch.

## Decisions

Delegated to me by the user; recorded here so they are explicit.

- **Terminals restore layout + cwd with a fresh shell.** No scrollback replay.
  Persisting and repainting old output would cost a disk write on every output
  burst, and stale text sitting above a live prompt is easy to mistake for
  current output. Layout and cwd carry the value; the rest is a trap.
- **Unsaved edits survive close (hot exit).** Dirty buffers are backed up to a
  store keyed by path and reapplied on restore, so closing with unsaved work does
  not force a save prompt.
- **Single source of truth.** The Tauri-store spaces layer wins; both localStorage
  layers are deleted rather than left as a fallback. Two writers to the same
  concept is how this drifted in the first place.
- **Restore always runs**, including when launched with an explicit directory.
  The old code skipped restore on `getLaunchDir()`; that made "open Gear here"
  silently throw away the session, which is the opposite of the goal. The launch
  directory now only decides where the *fresh* tab opens when there is nothing
  to restore.
- **A one-time migration** reads the old localStorage keys on first launch after
  upgrading, so existing users do not lose their tabs to the store switch.

## Architecture

### Stage A — session restore

```
App.tsx
  ├─ useTabs()            → gains replaceTabs(tabs, activeId), allocId, booted
  ├─ useSpacesBoot({...})  ← newly wired; reads gear-spaces.json, hydrates tabs
  └─ useSpacePersistence() ← newly wired; debounced write-back
        └─ serialize.ts    ← extended: settings/git-history tabs, editor
                              languageOverride + pin state, view state
```

Units and their contracts:

- **`serialize.ts`** — pure functions `serializeTabs`/`hydrateTabs`. No I/O, no
  React. Extended to cover the tab kinds it currently drops. Testable in isolation
  and already has a test file.
- **`store.ts`** — the only module that touches `gear-spaces.json`. Gains
  `saveViewState`/`loadViewState` for cursor/scroll and dirty-buffer backups.
- **`useSpacesBoot`** — runs once, hydrates, and is the *only* thing that decides
  what the first tab is. When nothing is restorable it calls `freshTerminalTab`,
  which is what fixes goal 3.
- **`useSpacePersistence`** — debounced writer, already written. Gate stays as-is.
- **`editorViewState.ts`** (new) — maps path → `{cursor, scrollTop}` and
  path → dirty buffer text. Kept separate from tab serialization so a corrupt
  view-state entry can never break tab restore.

`useTabs` initial state changes from the hardcoded `untitled` tab to an empty
array. Every consumer that assumes a non-empty `tabs` must tolerate the one frame
before boot completes — `booted` gates the UI.

### Stage B — explorer clipboard

```
Rust  src-tauri/src/modules/fs/clipboard.rs   (new)
        clipboard_read_files()  → Vec<String>   CF_HDROP / NSPasteboard / text-uri-list
        clipboard_write_files() → ()            so in-app copy is pasteable in Explorer
      src-tauri/src/modules/fs/mutate.rs        (extended)
        fs_copy    → collision-safe naming instead of hard error
        fs_move    → new; cut/paste and drag-move

TS    src/modules/explorer/lib/clipboard.ts     (new) in-app copy/cut register
      src/modules/explorer/lib/paste.ts         (new) pure "what does this paste do" planner
      FileExplorer.tsx / TreeRow.tsx            (extended) Ctrl+C/X/V, context menu
```

Paste resolution order, as a pure function in `paste.ts` so it is unit-testable
without a clipboard:

1. OS clipboard holds file paths → copy (or move, if they came from an in-app cut)
   into the target directory.
2. In-app register holds paths → same, using the register.
3. Clipboard holds an image → write `Pasted image <timestamp>.png` into the target.
4. Clipboard holds text → write `Pasted text <timestamp>.txt` into the target.

Collision handling is `name (copy).ext`, `name (copy 2).ext` — never a silent
overwrite, never a hard failure that makes the user rename by hand.

## Error handling

- Every restore entry hydrates inside a `try`; a corrupt entry is skipped, never
  fatal. (`hydrateTabs` already does this.)
- Restored editor tabs whose file no longer exists open showing the read error
  rather than being silently dropped — the user chose to have that tab open.
- Clipboard reads that find nothing usable show a toast, not a thrown error.
- All `fs_*` commands stay workspace-resolved via `resolve_path`; paste cannot
  write outside the authorized workspace.

## Testing

- `serialize.test.ts` — extended for the new tab kinds; round-trip properties.
- `editorViewState.test.ts` — new; cursor/scroll and dirty-buffer round-trip,
  corrupt-entry tolerance.
- `paste.test.ts` — new; the resolution order above and collision naming, as pure
  functions with no clipboard or filesystem.
- Rust `mutate.rs` tests — collision-safe naming, move semantics, refusal to
  escape the workspace root.
- Manual: close with N tabs open → reopen → same tabs, order, active tab, cursor,
  unsaved edits. Fresh profile → terminal, not untitled.

## Out of scope

- Restoring terminal scrollback or re-running processes.
- Cross-machine or cloud session sync.
- **Writing** a file list *onto* the OS clipboard (copy in Gear → paste in
  Explorer). The ask was pasting into Gear; Gear→Gear is covered by the in-app
  register, and Gear's copy also puts the paths on the clipboard as text.
  Building CF_HDROP / NSPasteboard writers is a separate piece of work.
- Restoring `ai-diff` / `git-diff` / `git-commit-file` tabs: these are derived
  views over transient state (a pending approval, a working-tree diff) that may
  not exist on next launch. They stay session-local.
