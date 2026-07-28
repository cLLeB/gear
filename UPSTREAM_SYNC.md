# Upstream Sync Tracker — terax-ai → Gear

Upstream: `https://github.com/crynta/terax-ai` (git remote `upstream`).
Our history is **unrelated** (the rebrand rewrote history), so sync is done by
**porting selected commits by hand**, never merging. Everything ported keeps
**Gear** branding — never "Terax".

**Window:** `a7506be` (0.8.5 tip, end of the last sync) → `d23e16f` (0.8.6 tip) — **40 commits**.
**Opened:** 2026-07-28

Legend: ✅ ported · 🔁 covered-by-equivalent · ⏭️ skip · 🟡 pending

## Status

| | count |
|---|---|
| ✅ ported | 24 |
| 🔁 covered by an existing Gear equivalent | 3 |
| ⏭️ skipped (deps / branding / not applicable) | 13 |
| 🟡 still pending | 0 |

**All 40 commits in the window are resolved.**

**Verification:** `pnpm test` **217 files / 1345 tests green** (baseline before
this sync: 196 / 1175) · `cargo test --lib` **156 passed** (baseline 147) ·
`tsc --noEmit` clean · `cargo build --lib` clean.

---

## Terminal / PTY

| st | commit | subject | outcome |
|----|--------|---------|---------|
| ✅ | `4634739` + `2b2973f` | preserve native keys in alternate screen | **Was a live bug in Gear.** `rendererPool.ts` applied the line/word/delete readline remaps unconditionally, stealing keys from vim/tmux/less/htop. Added `terminalReadlineSequence()` to `keymap.ts` (pure, guards on `isAlternateScreen`), collapsed the three blocks in `rendererPool` into one call. +8 tests (29 in `keymap.test.ts`). |
| ✅ | `ac88362` | preserve terminal response order | Added the `is_startup_query = !saw_output && out.is_empty()` gate to the DA branch of `da_filter.rs`, so a DA reply is only synthesized for a genuine startup probe and otherwise passes through in order. Rewrote 2 tests that encoded the old behaviour, added 3. 23 tests green. |
| ✅ | `d6e3491` + `460657a` | directional pane swapping + preserve layout | Added `PaneDirection`/`PaneBounds`/`swapLeafInDirection` + `firstLeafSlotId` to `panes.ts`; `slotId` keeps React panel identity pinned to the *position* so a swap doesn't reset the resize layout. Wired `Mod+Alt+Arrow` through `shortcuts.ts` → `App.tsx` → `useTabs.swapActivePaneInDirection`, with `livePaneBounds()` measuring real DOM rects. New `shortcutScope.ts` releases the binding when there's nothing to swap (it collides with terminal word-nav). New `panes.test.ts` (11) + `shortcutScope.test.ts` (5). |
| 🔁 | `2e86730` | drag explorer paths into terminal | Covered by our own `src/lib/pathDrag.ts` + draggable `TreeRow` + `PaneTreeView` drop target. Upstream reaches the same feature a different way; not worth churning. |

## Tabs / Spaces

| st | commit | subject | outcome |
|----|--------|---------|---------|
| ✅ | `40c4c89` | preview tabs for git diffs | Added `preview` to `GitDiffTab` and extracted a pure `planGitDiffOpen()` (new `tabs/lib/planGitDiffOpen.ts`, 10 tests). Also fixed an existing gap: `openGitDiffTab` never set `spaceId`, so diffs weren't scoped to a space — they are now, matching every other opener. `pinTab` now promotes git-diff previews too. |
| ✅ | `3e9f374` + `0dc259d` + `f1b92fc` | agent status on tabs → on the tab icon | Ported as one net change (skipped the intermediate `AgentTabBadge`). Our Rust detector already emitted `kind` + `agent`; the frontend was throwing it away. `agentActivity.ts` now keeps a phase/agent store with a finished-TTL, plus pure `phaseForSignal()` and `tabAgentStatus()`. `TabIcon` tints by phase (attention > working > finished), private terminals excluded. Added `ptyIdForLeaf()`. 9 tests. |
| ✅ | `c1ec0e6` + `0b5e81b` | launch coding agents in split panes | Ported `launcher.ts` verbatim (pure — 10 tests pass unmodified) plus `AgentLauncherPanel.tsx`. **Adapted rather than copied:** upstream replaces the whole "+" menu with their `NewTabMenu`, which would have dropped our per-shell submenus — so ours rebuilds `NewTabMenu` around *our* menu content (shell picker, block-terminal submenu) and adds a "Coding agents" item. Kept upstream's menu↔popover handoff (`onCloseAutoFocus` + `requestAnimationFrame`), which is what `0b5e81b` exists to fix. `newAgentGroupTab` pre-splits a tab into 1–4 panes via `createAgentPanePlan` and each pane runs the agent's command once its session is ready; hooks are installed once for the group and awaited first. Per-agent commands persist via `agentLaunchCommands` in the settings store. |

## Agents

| st | commit | subject | outcome |
|----|--------|---------|---------|
| ✅ | `332a0c2` | collapse the agent-alerts list | Ported, **and closed a real gap**: our backend has supported claude/codex/gemini hooks since `05c83f7`, but `NotificationBell` only ever exposed Claude. It now lists every hook agent behind the collapse toggle with per-agent enable/enabled rows. |
| ✅ | `7639523` | Pi coding-agent notifications | Ported Gear-branded: `"pi"` added to `DEFAULT_AGENTS`, and a separate extension-writer path in `agent.rs` (Pi loads TypeScript extensions, not JSON hooks) writing `~/.pi/agent/extensions/gear-notifications.ts`. Refuses to overwrite a file it doesn't own, resolves symlinks before writing, writes atomically. Marker is `notify;Gear;pi;<event>` gated on `GEAR_TERMINAL`. **Deliberate deviation:** skipped `LICENSES/pi-logo.txt` and Pi's brand mark — `AgentIcon` falls back to the generic robot icon rather than redistributing a third-party logo. 5 tests. |
| 🔁 | `5c2f4cd` | route status-bar AI button through key-aware toggle | `StatusBar.tsx` already does `hasComposer ? openPanel : onConnectProvider` — same intent, different shape. |

## Editor / LSP / Theme

| st | commit | subject | outcome |
|----|--------|---------|---------|
| ✅ | `1fdbc50` | Svelte syntax highlighting | We shipped the Svelte file icon and `svelte-ls` preset but no CodeMirror mode, so `.svelte` had no highlighting at all. Added `@replit/codemirror-lang-svelte`, a loader in `languageResolver.ts`, `Svelte` in the language picker, and `svelte` to Prettier's language list. (Upstream's vite manual-chunk hunk is N/A — we don't chunk `cm-lang-*`.) |
| ✅ | `fa68ae3` (adapted) | guide LSP installation | Mostly **covered**: our `InstallPill` in `LspStatusPill.tsx` already offers the install command with copy, a docs link, and "Check again" — the same data upstream's dialog shows, surfaced inline instead of inside a settings servers list we don't have. Ported the one genuine delta: a "Still not found" message after a failed re-check, so the button no longer looks inert. `lspSwitchState.ts` is N/A (it only drives upstream's servers list). |
| ✅ | `89c65f0` + `cf30c25` | terminal font overrides in themes | Added optional `fontFamily`/`fontWeight`/`fontSize` to `TerminalPalette`, `resolveTerminalFont()` (theme wins per-field over prefs), `useTerminalFont()`, and validation that **skips** malformed fields rather than rejecting the theme (matching the rest of our validator, unlike upstream's error-returning style). Exposed `activeTheme` on the theme context. Wired through `useTerminalSession`, `ShellInput`, and a module-level applied-font cache in `rendererPool` so newly created panes don't briefly render the raw preference. 9 tests. |

## Explorer

| st | commit | subject | outcome |
|----|--------|---------|---------|
| ✅ | `7037d55` | prevent sidebar scroll bleed | One line — `cn("flex flex-col", active && "min-h-0 flex-1")`. Our `ExplorerSearch.tsx` had the identical structure, so the bug was ours too. |

## Bundle / OS integration

| st | commit | subject | outcome |
|----|--------|---------|---------|
| ✅ | `b9d6039` + `a2c8329` | open files via the OS "Open With" action | Added `fileAssociations` (58 extensions, "Gear Document") to `tauri.conf.json`; generalised launch-arg parsing from one directory to N files + a directory via a pure `resolve_launch_target()` (5 tests) plus `LaunchFiles` state and a `get_launch_files` command; `consumeLaunchFiles()` + an App effect opens them. Also fixed argv being canonicalized three times with three chances to disagree — now parsed once. ⚠️ **Needs a real installer run to verify** the Explorer context-menu entry actually registers. |

## Release / CI

| st | commit | subject | outcome |
|----|--------|---------|---------|
| ✅ | `d23e16f` (adapted) | rewrite updater urls for re-signed artifacts | **Fixed a live bug in our own pipeline.** `release.yml` patched `latest.json` with `jq` and then *never uploaded it*, so the patch was dead code; meanwhile `--clobber` re-uploading the re-signed AppImage recreates the asset under a new id, invalidating the asset-id URL tauri-action baked into the published manifest. Both the signature and the URL on the release were therefore wrong — Linux auto-update could not have worked. Moved the fix into a `patch-updater-manifest` job (`needs: build`), which also removes a matrix race where a later platform's tauri-action run would overwrite an in-matrix patch. ⚠️ **Only a real tagged release can confirm this end to end.** |
| ⏭️ | `5676de7` | authenticode-sign windows builds via signpath | Bound to upstream's SignPath org/project/cert. Not portable. Gear would need its own SignPath OSS certificate — worth doing, but it's a separate piece of work, not a sync. |
| ⏭️ | `d630bb3` | remove shebang from eager-graph.mjs | N/A — we have no `scripts/eager-graph.mjs`. |

## Chores / deps / docs — skipped

| st | commits | reason |
|----|---------|--------|
| ⏭️ | `a069d6f`, `3e654c3`, `841c726`, `fd1e78c`, `5463119` | Dependency bumps. We run **our own dependabot** (npm + cargo + github-actions, weekly) and already have 15 open dependabot branches on `origin`. Porting upstream's lockfile churn would fight it. |
| ⏭️ | `46b6073` | `actions/setup-node` 6→7. Ours is on **v4** — a different bump, owned by our dependabot's github-actions ecosystem. Noted, not ported. |
| ⏭️ | `b8dc2bd`, `e9ee1d6` | Version bump to 0.8.6. We keep our own version line (`0.1.2`) driven by release-please. |
| ⏭️ | `1e63968`, `e5c3964` | `LICENSES/` drop + Pi mark inline; SignPath README attribution. Terax-specific branding/attribution. |

---

## Tests (free coverage)

| st | commit | subject | outcome |
|----|--------|---------|---------|
| ✅ | `fcff6c5`, `f3abcb3`, `d010ba4`, `fd99bf6` | upstream test-coverage commits | All 14 target modules existed in our tree. **12 of the 14 files passed unmodified** (104 tests) — only a `terax`→`gear` fixture rename was needed in `pathUtils.test.ts`. The 2 failures were genuine divergences, both worth fixing rather than editing the test around: (1) `isMarkdownPath` lived as a private copy in `TreeRow.tsx` — hoisted to `lib/utils.ts` (our copy was byte-identical to upstream's); (2) `matchBinding` had no physical-code fallback for alt bindings, so any Alt shortcut is unreachable on macOS/non-US layouts where Option rewrites `e.key` (Alt+C → "ç") — **this now matters more because the pane-swap bindings added above are `Mod+Alt+Arrow`**. Added `CODE_TO_KEY` + `keyFromCode`. |

## Naming rule for every port

Upstream strings must be rewritten on the way in:
`Terax` → `Gear`, `terax` → `gear`, `TERAX_TERMINAL` → `GEAR_TERMINAL`,
`notify;Terax;…` → `notify;Gear;…`, `terax:` events → `gear:`.
