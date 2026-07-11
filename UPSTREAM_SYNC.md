# Upstream Sync Tracker — terax-ai → Gear

Upstream: `https://github.com/crynta/terax-ai` (`git remote: upstream`)
Our fork history is **unrelated** (rebrand rewrote history), so sync is done by
**porting selected commits**, not merging. This file tracks the triage of every
upstream commit in the current window so progress survives interruptions.

**Window:** `v0.8.2` (`63099f5`) → `0.8.5` tip (`a7506be`) — 55 commits.
**Last updated:** 2026-07-11

Legend: ✅ ported · 🔁 covered-by-equivalent (our own impl) · ⏭️ skip (chore/docs/deps/mac-linux-only) · 🟡 pending · 🔎 needs-review

---

## AI
| st | commit | subject | notes |
|----|--------|---------|-------|
| ✅ | 78a0b3d | Harden AI search tool path filtering (#960) | ported — search readability/secret filter |
| ✅ | 882641e | fix(ai): surface provider errors safely | ported — `errors.ts` sanitize+prefix |
| ✅ | 9616cc8 | feat(ai): add current frontier models | PORTED — added GPT-5.6 Sol/Terra/Luna, Claude Fable 5 + Sonnet 5, Grok 4.5; `supportsTemperature` + `modelSupportsTemperature`/`modelUsesReasoningTokens` helpers gate temperature/reasoning in autocomplete + commit-gen (fixes latent temp-on-GPT-5 bug); context limits + pricing; new `config.test.ts` (31 tests). **Dep bumps (SDK versions) + pnpm-lock deferred** — new ids work with current SDKs; covered separately by dependabot commits in-window. |
| 🟡 | fe4e074 | feat(ai): shortcut to toggle AI chat mini window | want — small, low-risk |
| 🔎 | 89e399a | feat(agents): notification hooks for Codex/Gemini CLI | review — depends if we ship those agents |
| 🔎 | b23cd00 | feat(agents): per-agent notification bell + clear | review |
| 🔎 | 68caf02 | feat(agents): shortcut to jump to agent needing attention | review |
| 🔎 | ef55e36 | fix(agents): harden self-arm + notification UX | review (follows above) |

## Terminal / PTY
| st | commit | subject | notes |
|----|--------|---------|-------|
| 🔁 | a3ebccd | fix(terminal): native clipboard copy/paste on Linux (#713) | partial via `c9cbb57` (Linux clipboard). **See PowerShell Ctrl+C/V request — separate custom work** |
| 🟡 | 52b90c1 | fix(pty): rewrap fish prompt after config.fish on WSL/Windows | want (Windows-relevant) |
| 🔁 | d96da41 | refactor(proc): move windows job object out of pty | likely covered by our Windows PTY work; verify |

## Editor / LSP
| st | commit | subject | notes |
|----|--------|---------|-------|
| 🔁 | 3c3ded3..1ddf798 | LSP subsystem (rust host, client, sessions, chrome, watchdog) | covered by `242551f feat(lsp): adopt LSP subsystem` — verify parity |
| 🔁 | fef9f22 | fix(lsp): age-guard idle eviction | ported as `4ffa69b` |
| 🔎 | 42b51e7 | feat(lsp): find references picker, ruff preset | review — may post-date our LSP adopt |
| 🔎 | 3791846 | feat(lsp): presets for 13 more languages | review — expand our preset list |
| 🔎 | e874b39 | feat(lsp): cmd-hover link, hover highlight, statusbar | review |
| 🔁 | d77476e | feat(editor): per-tab language override dropdown | ported as `aa673f3` |
| 🟡 | 653dd15 | feat(settings): dedicated editor tab | review — settings UX |
| 🟡 | a25fb40 | feat(editor): biome+prettier format-on-save | **big** — want? verify against our editor |
| 🟡 | 6980581 | feat(editor): find/replace panel, goto line, large file open | want — core editor UX |
| ✅ | 662dbbb | fix(editor): line endings, save conflicts, block quit unsaved | PORTED — `eol.ts` (+9 tests) preserves CRLF/LF; `useDocument` detects save conflicts via mtime (toast + Overwrite) and gains `openAnyway`; `useAppCloseGuard` blocks quit on unsaved editors (kept our destroy()-based close). |
| 🟡 | 40a8ef2 | feat(fs): async file commands, mtime, symlink stat | PARTIAL — ported the **contract** our editor needs (`fs_write_file`→mtime, `fs_read_file` `force`+mtime, `FORCE_MAX_READ_BYTES`), kept commands **sync** + our chronicle logic. Deferred: async conversion, `fs_stat` symlink_metadata fix. |
| ✅ | 85a5653 | fix(editor): save/reload races, formatter mtime, lsp format style + preset rebinding | PORTED (applicable parts) — writeToDisk stays dirty if edited mid-write; reload re-checks dirty after the async read; close-guard counts dirty after the busy-await; `useLspExtension` rebinds on preset swap; LSP format honors tab vs space indent (`indentUnit`). N/A: formatter-mtime / `adoptDiskText` (our fork has no external-formatter infra — `externalFormat.ts` absent). |
| 🟡 | 786ceb5 | feat(editor): markdown notes GFM, clickable tasks | review |
| 🟡 | 7b1fae6 | feat(editor): AI autocomplete placement/quality/triggers | review |
| ✅ | 9ec7328 | fix(editor): resolve diff pane language before mount | COVERED — our AiDiffPane/GitDiffPane already seed `resolveLanguageSync(path)` before mount. |
| 🟡 | e63ca2f | feat(editor): independent font sizing | want — small |
| 🟡 | ae9e690 | feat(editor): dotenv syntax highlighting | want — small |
| ⏭️ | 7649926 | fix(editor): refine Kanagawa JSX colors | N/A — our fork ships no Kanagawa theme. |
| 🟡 | 1fd11b0 | fix(editor): freeze extension singletons, autosave clamp | review — perf |
| 🟡 | 2219adb | feat(editor): completion icons, themed lsp chrome, vim cursor | review |

## Tabs / Spaces / Workspace / Sidebar
| st | commit | subject | notes |
|----|--------|---------|-------|
| 🔎 | 4d3160d | fix(tabs): scope Cmd+number to active space (#881) | review — we have spaces |
| 🔎 | 3d1ba19 | feat(workspace): default environment for new spaces (#869) | review — we have spaces |
| ✅ | 3f4d680 | feat(sidebar): persist collapsed state (#903) | PORTED — `Gear.sidebar.collapsed` localStorage; both sidebar panels honor it on load + persist on resize. |
| ✅ | a71fcfc | fix(shortcuts): move zen mode off editor redo binding | PORTED — zen toggle moved to Mod+Shift+' (both mac/non-mac) off CodeMirror redo. |

## Source control
| st | commit | subject | notes |
|----|--------|---------|-------|
| 🔎 | bba1b5f | feat(source-control): checkout branches in UI (#866) | review — do we ship SCM panel? |

## Explorer / Markdown / Media
| st | commit | subject | notes |
|----|--------|---------|-------|
| ⏭️ | 2930d8e | fix(explorer): empty file tree on rapid root change (#822) | N/A — our `useFileTree` has no `nodesRef`/`sameDirListing` early-return; different impl, fix not applicable. |
| ✅ | c0a51d5 | fix(markdown): preserve HTML-wrapped code block text (#887) | PORTED — recursive `markdownCodeText` extractor + test. |
| 🔁 | cb75fae | fix(markdown): render file previews statically (#913) | review vs our media preview work |

## Chores / deps / docs / release (default ⏭️ skip unless needed)
| st | commit | subject |
|----|--------|---------|
| ⏭️ | 564e145 | nix: update sources to 0.8.2 |
| ⏭️ | 0baf265 / a7506be | release v0.8.5 + nix 0.8.5 |
| ⏭️ | 9bee3be, ba0e276, 1005caa, 831860b | dependency bumps (evaluate individually if needed) |
| ⏭️ | c1b789b, 1c7f3e4, 7250e4a, 7b69f5d, 57bbc57 | docs (TERAX.md / architecture) |

---

## Requested custom features (NOT upstream ports — net-new for Gear)
1. ✅ **PowerShell plain Ctrl+C / Ctrl+V** (no Ctrl+Shift), bash keeps Shift. DONE — `keymap.ts` `terminalClipboardIntent` + `isPowerShellShellPath`; `rendererPool.ts` handler (Ctrl+C copies on selection, else passes through as SIGINT); `useTerminalSession.ts` adapter `isLeafPowerShell`. 21 keymap tests pass.
2. ✅ **Drag file into terminal → paste path.** DONE (in-app sidebar drag). `src/lib/pathDrag.ts` (HTML5 DataTransfer payload); `TreeRow.tsx` rows now `draggable` (multi-select aware); `PaneTreeView.tsx` pane is a drop target that pastes shell-quoted path(s) + shows the existing drop overlay. 7 tests. OS-Explorer drop was already built (`useTerminalFileDrop.ts`). ⚠️ needs a real drag-gesture runtime check in the app.
3. ✅ **Tab-bar overflow menu: Close Others / Close Saved / Close All** (VS Code-style). DONE. `useTabs.closeTabs(ids)` (disposes sessions, keeps active space non-empty); `computeCloseTargets` pure helper (+4 tests); "⋯" `DropdownMenu` at tab-strip corner in `TabBar.tsx`, threaded via `Header.tsx` + `App.tsx`. "Close Saved" leaves live terminals and dirty editors alone.
4. 🟡 **Competitive scan** (VS Code / Zen / Warp / Sublime) → see `COMPETITIVE_SCAN.md`.

All 219 tests pass; 0 type errors. Commits pending (GPG must be run by user).
