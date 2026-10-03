# Improvements — checkpoint 1

Everything below is reachable from the command palette (Mod+Shift+P) unless
noted; tunable behaviour lives in **Settings → Features**.

## Platform
- Quick pick / input box service used by all new commands
- Palette: fuzzy ranking with highlights, "Recently used", `@` symbol and `:` line prefixes
- Schema-driven Features settings tab with search
- Shortcut conflict detection (fixed two conflicting defaults: session timeline is now Mod+Shift+H; Clear terminal on Linux/Windows is Ctrl+Shift+L)

## Terminal
- Jump to previous/next prompt (Mod+Up/Down), copy last command / output, rerun last command
- Notification when a long command finishes in the background
- Problem matchers (tsc, eslint, rustc, gcc/clang, go, mypy, pytest, Python, Node) + next/previous problem
- Clickable `path:line:col` links
- Dev-server detection → open in preview
- Secret-leak warnings with "clear scrollback"
- "Did you mean …?" typo correction
- Quick select (URLs, paths, hashes, IPs, UUIDs…)
- Save/copy scrollback as text, ANSI or coloured HTML
- Frecent directory jump (zoxide-style)
- Workflows: parameterised command library + `.gear/workflows.json` + saved commands
- Destructive-command confirmation
- Program notifications (OSC 9 / 777 / 99), OSC 9;4 progress rings on tabs
- Bell badges + visual bell, activity/silence monitors, read-only panes
- Paste special, iTerm2-style triggers, Atuin-style history search, offline command explainer
- AI: ask about the last command, generate a command from a description
- Status bar: last command ✓/✗ and duration

## Panes & tabs
- Pane zoom (Mod+Shift+Enter), equalize, flip split, tmux layout presets
- Reopen closed tabs (Mod+Alt+T) incl. split layouts
- Saved layouts with startup commands

## Workspace
- Auto-detected tasks (npm/pnpm/yarn/bun, make, just, deno, composer, Taskfile, Poetry/PDM/uv, Cargo, Go, compose)
- `.env` lint and drift vs `.env.example`
- Workspace TODO/FIXME list

## Editor (Text group)
- Increment/decrement (Mod+Alt+= / -), toggle word (Mod+Alt+T), surround (Mod+Alt+S)
- JSON ⇄ YAML, deep key sort, Markdown/CSV table tools, encode/decode, hashes
- UUID v4/v7, ULID, NanoID, timestamps, epoch ⇄ ISO, JWT inspector, calculator, cron explainer
- Colour swatches, bookmarks (Mod+Alt+K/L/J), TODO highlighting, rulers & whitespace rendering
- Go to symbol (Mod+Shift+O), local rename (F2 without LSP), copy reference
- Sequences at cursors, cursors at line ends (Shift+Alt+I), Markdown TOC & formatting
- SQL / XML / HTML formatting, quote switching (Mod+Alt+'), organize imports (Shift+Alt+O)
- Rewrap (Alt+Q), align (Mod+Alt+A), inline merge-conflict resolution

## Git
- Gutter change markers (Alt+F5 / Shift+Alt+F5), commit-message lint
- Permalinks / open on GitHub-GitLab-Bitbucket-Gitea-Azure, open pull request
- Switch/create branch, clean up merged/gone branches, file history
- Undo last commit (soft), fold staged changes into an earlier commit (fixup + autosquash)
