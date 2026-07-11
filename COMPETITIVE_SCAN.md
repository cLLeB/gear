# Competitive Scan — lightweight wins for Gear

Scope: features from **VS Code**, **Zed / Zen**, **Warp**, **Sublime Text** that are
*cheap to build, cheap at runtime,* and don't compromise Gear's lean-terminal goal.
Heavy features (minimap, real-time collab, extension marketplace, telemetry) are
explicitly out.

**Already in Gear** (do NOT re-add): command palette, fuzzy quick-open, spaces/workspaces,
split panes, Warp-style command blocks, block copy/select, LSP + diagnostics, vim mode,
AI chat/agents, themes + live preview, media preview, markdown preview, git graph/diff/history,
zen mode, per-tab language override, session restore, chronicle/rewind time-travel,
sidebar toggle, tab drag-reorder, Close Others/Saved/All (added this session),
file drag → terminal (added this session).

Legend: 🟢 recommend (light, high value) · 🟡 maybe (worth it, a bit more work) · 🔴 skip (too heavy / off-goal)

---

## 🟢 Top recommendations (light + high value)

| # | Feature | From | Why it fits Gear | Effort |
|---|---------|------|------------------|--------|
| 1 | **Notify when a long command finishes while unfocused** | Warp, iTerm | Terminal-native. Gear already captures command start/end via OSC 133 (chronicle) + `agentActivity` — hook a desktop notification when elapsed > N s and window blurred. | S |
| 2 | **Reopen recently closed tab** (`Ctrl+Shift+T`*) | VS Code, Sublime, browsers | Tiny closed-tab stack in `useTabs`; restore editor tabs by path, terminals as fresh shell in same cwd. High daily value. (*shortcut currently maps to block terminal — pick another, e.g. `Ctrl+Shift+O`.) | S |
| 3 | **Open-tabs overflow list** | VS Code | We just added a "⋯" corner menu — add a second dropdown listing all open tabs to jump to when they overflow the strip. | S |
| 4 | **Copy command / Copy output on block hover** | Warp | Block decorations already exist (`blockDecorations.ts`); add two hover actions. Pure terminal ergonomics. | S |
| 5 | **Auto-save (on focus-loss / after delay)** | VS Code, Sublime | One setting + a debounce in the editor save path. The editor already tracks `dirty` + mtime save-conflict logic. | S |

## 🟡 Worth considering

| # | Feature | From | Notes | Effort |
|---|---------|------|-------|--------|
| 6 | **Pinned tabs** | VS Code, browsers | Pin keeps a tab at the strip start, smaller, no close-on-“Close Others/All”. Adds a `pinned` flag to tabs + sort. Interacts with Close-Saved/All rules. | M |
| 7 | **Sticky prompt header** while scrolling long output | Warp | Keeps the current command visible at the top while its output scrolls. Nice, but needs scroll bookkeeping over xterm. | M |
| 8 | **Goto Symbol in file** (`Ctrl+R`) | Sublime, Zed | LSP `documentSymbol` → quick-pick. We already have the LSP client + a references picker to model it on. | M |
| 9 | **Inline git blame (gutter, current line)** | Zed, GitLens | Chronicle already does blame-across-time; a lightweight current-line gutter annotation would echo Zed. Defer if chronicle covers the need. | M |
| 10 | **Compact / auto-hiding sidebar** | Zen Browser | Sidebar collapses to a hover-reveal rail. Sidebar toggle exists; this is the auto-hide variant. | M |

## 🔴 Skip (against the lean goal)

Minimap · extension marketplace · real-time collaboration · integrated debugger UI ·
settings-sync cloud account · telemetry · multi-root project heavyweight indexing ·
built-in browser devtools panel.

---

## Suggested build order (all Small, high-ROI first)
1. Reopen recently closed tab (#2)
2. Long-command finished notification (#1)
3. Copy command / output on block hover (#4)
4. Open-tabs overflow list (#3)
5. Auto-save setting (#5)

Then reassess 🟡 items with real usage. Each Small item is a self-contained PR-sized change
with unit tests, consistent with the modules already in `src/modules/`.
