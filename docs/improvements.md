# Improvements

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

# Checkpoint 2

## Terminal
- Paste screenshots / copied images and files into terminal apps (Claude Code, Codex…) as file paths; "Paste clipboard image as file path"
- Command log per pane (status, duration, scroll to, rerun, copy output)
- Run selected text / current line in the terminal; re-run last command on save (toggle)
- SSH host picker (~/.ssh/config), Docker containers (shell, logs, stats, start/stop, remove), listening ports (preview, kill)
- Record a pane to asciinema (.cast); environment variable browser
- Copy on select and right-click paste / copy-else-paste (Settings → Features)

## Tabs, panes & notifications
- Switch to recent tab (MRU), go to previous tab, duplicate terminal tab
- Move pane to a new tab / join a tab into the current one (live shells kept)
- Notification history (every toast and OS notification)

## Editor (Text group)
- Copy JSON / YAML path (JSONPath, jq, JS, JSON Pointer, dotted)
- Generate TypeScript / Zod / Go / Rust / Python types from JSON
- Convert curl to fetch / Python requests / PowerShell
- Send the HTTP request under the cursor (.http / .rest files)
- Word count & statistics, sort lines by natural/length/number/column/shuffle
- Number base conversion, change case (title/sentence/swap)
- Flag and clean bidi (Trojan Source), zero-width, odd-space and homoglyph characters
- Select all regex matches, fake data, paste URL as Markdown link, copy as Markdown code block
- Compare file/selection with clipboard, with another file, or with the saved copy

## Git
- Stash changes / manage stashes (apply, pop, per-file diff, branch, drop)
- Worktrees (create in a sibling folder + terminal, open, remove, prune)
- Create / delete tags with semver suggestions, cherry-pick from a branch
- Guided bisect (incl. `git bisect run`), reword last commit, restore file from ref, add to .gitignore

## Workspace
- Replace in files (literal or /regex/iw, $1/$<name>, case operators, preview)
- Go to symbol in workspace (regex-based, no LSP)
- Largest files, code statistics per language
- Generate .gitignore from detected stacks, add a LICENSE file

## Themes
- Import iTerm2, Windows Terminal, VS Code, Alacritty, Kitty, Ghostty, Xresources and base16 schemes
- WCAG contrast check of the active theme

# Checkpoint 3

## Local development
- `codes/` scripts (Windows PowerShell and macOS/Linux) install the toolchain, clone or update the repo into `~/codes/gear` and install dependencies; `update.ps1` / `update.sh` pull the latest changes

## Editor: data formats
- Convert CSV/TSV ⇄ JSON, JSON ⇄ TOML, XML ⇄ JSON, .env ⇄ JSON, query string ⇄ JSON, JSON array → Markdown table

## Tools (new palette group)
- Subnet/CIDR calculator, chmod calculator, semver range explainer/tester, regex explainer
- Duration converter, days between dates, time zone converter / world clock, unit converter
- Password / passphrase generator, signed test JWT (HS256), HTTP status codes, exit code / signal explainer, colour contrast checker

## Editor: code & writing
- Insert / remove debug logs (12 languages), surround with try/if/for…, extract variable, concatenation → template literal
- Writing checks, Markdown link & anchor checker, renumber lists, HTML / rich text → Markdown, line numbers
- Snippets with tab stops (built-in + your own), clipboard history, scratchpad
- File info (encoding, EOL, SHA-256, last commit), hex view, copy as data URI, go to file:line from clipboard, open recent file, lock file
- Rainbow brackets (unmatched flagged), indentation rainbow, sticky scroll, go back / forward with history

## Terminal
- Find in all terminals, filter scrollback, marks, copy command + output as Markdown
- Activate venv / nvm / asdf, new terminal at the file's folder, copy current directory
- Kubernetes contexts & pods, process list & kill, scheduled / repeating commands, rotate panes, run in all terminals
- Failed commands explained in the command log

## Git
- Commit for the current line, compare branches, files changed on this branch, conventional-commit builder
- Search history (message / author / pickaxe), reflog recovery, contributors
- Push with options, remotes, submodules, create / apply patches, revert, squash, copy SHA, open repository pages

## Workspace
- Outdated dependencies (npm/pnpm/yarn/pip), duplicate files, new file from 19 templates
- Generate README, update CHANGELOG from commits, bump version (+ commit & tag)
- Copy file tree, copy files as AI context, token estimates, secrets scan, file checksums & verify

## AI (uses the model configured in Settings → Models)
- Explain code, doc comments, unit tests, review changes, rename suggestions, translate code
- PR description, regex / jq / SQL / awk / sed / XPath / cron from a description
- Summarize command output, edit selection by instruction (with diff), explain stack traces

## Look & feel
- Generate a theme from an accent colour, light/dark schedule, focus (Pomodoro) timer in the status bar

# Checkpoint 4

## Editor
- JSON ⇄ JS object literal; escape / unescape for C/Java, Python, shell, PowerShell, SQL, regex, CSV, XML
- Join / split / wrap lines, SQL IN lists, CSV transpose, duplicate-line frequency table, compare two selections
- Markdown: paste clipboard image as a saved file + link, callouts, copy as rich text / HTML
- Colour scales (50–950) as CSS / Tailwind / SCSS; Base32, Base58, ROT13, Morse, binary
- Inspect UUID / ULID / ObjectId / Snowflake ids and URLs at the cursor
- Validate JSON / YAML / TOML / XML (jump to error); JSON Schema from a sample; flatten / unflatten JSON; structural JSON diff → JSON Patch; SQL keyword case & minify

## Terminal & tools
- Run a command in a new split pane; benchmark a command (mean ± σ, median, p95)
- Check a URL (status, timing breakdown, redirects, headers, security headers); DNS lookup
- Presentation mode (bigger fonts)

## Git
- Line ownership, file at another revision, stage / unstage / discard the current file, commit graph
- Rename / delete branches, sync (pull --rebase + push), history of selected lines, per-repo identity, activity summary

## Workspace
- Unused / missing npm dependencies, dependency licences, env vars used in code vs .env.example
- New project via official generators, check links in all Markdown files, bulk rename by regex
- Go to imported file, find usages across the workspace

## AI
- Convert commands between Bash / PowerShell / cmd / fish, generate scripts
- Ask about the project, release notes, summarize uncommitted changes, branch names
- Add types, mock data, translate selected text

# Checkpoint 5

## Large features

### Visual git client
- **Hunk & line staging in the diff tab** — Stage / Unstage / Discard buttons above every hunk, plus "Stage selection" for any line range. Builds a partial patch and applies it with `git apply --cached --recount`; the Source Control panel refreshes immediately.
- **3-way merge editor** — Ours | editable Result | Theirs. Non-conflicting changes from both sides are merged automatically (line-level diff3 on a Myers diff, fast on 20k-line files); each conflict has Accept ours / theirs / both buttons on the side panes and the inline lens in the result; conflict navigation, All ours / All theirs, Reset; "Save & mark resolved" stages the file and, after the last conflict, offers to continue the merge / rebase / cherry-pick. "Git: Resolve merge conflicts…" lists conflicted files (including deleted-by-us/them) with continue / skip / abort; the inline conflict lens gains "Open merge editor".
- **Visual interactive rebase** — drag commits to reorder (or Alt+↑/↓), pick / reword / edit / squash / fixup / drop per commit, inline reword (applied with an `exec git commit --amend`, so no editor opens), autosquash for `fixup!`/`squash!`, a live preview of the resulting history, and warnings for pushed commits, dropped fixup targets and uncommitted changes (`--autostash`).

### Debugger (Debug Adapter Protocol)
- **Run and Debug view** in the sidebar: start / continue / pause / step over / into / out / restart / stop, call stack with threads, variables tree (lazy, double-click to edit), watch expressions, breakpoints list with exception filters, and a debug console with a REPL that evaluates in the selected frame.
- **Editor integration** — breakpoint gutter (click to toggle; right-click for conditional, hit-count and logpoints, run to line), unverified / disabled styles, the paused line and caller frames highlighted, inline variable values while paused, breakpoints that move with edits.
- **Adapters** — Python (debugpy), Node.js (js-debug, incl. child sessions), Go (Delve), C / C++ / Rust (lldb-dap, gdb ≥ 14 or CodeLLDB). Stdio adapters reuse the LSP process plumbing; TCP adapters use a new Rust transport. Project `.venv` is picked up automatically.
- **Configurations** — reads `.vscode/launch.json` (JSONC, `${workspaceFolder}`/`${file}`/`${env:X}`…, `python`/`debugpy`/`node`/`pwa-node`/`go`/`lldb`/`cppdbg` types), or debugs the active file with zero config; `preLaunchCommand` runs a build first.
- **Keys** — F6 start / pause, F5 continue while debugging (else Run file), F9 breakpoint, F10 / F11 / Shift+F11 step (only while paused, so terminal apps keep them), Shift+F5 stop.
- Integration-tested against real debugpy, gdb and Delve sessions.

### Test explorer
- **Testing view** — every Vitest / Jest, pytest, Go and Rust test in the workspace, found statically (no run needed) and grouped by file and suite; run all / a file / a suite / one test, debug a test in the debugger, failure messages, durations, failed-only filter and the raw output.
- **Editor** — a run / status marker beside each test (click to run, right-click to debug or run with coverage), the failure message shown on the failing line, markers that follow edits.
- **Coverage** — run with coverage (Vitest / Jest lcov, pytest-cov, `go test -coverprofile`) and see covered / missed lines in the gutter of every source file, with per-file percentages.
- Results come from each framework's machine-readable reporter (JSON, JUnit XML, `go test -json`, cargo output); the parsers are tested against real reporter output.

### Jupyter notebooks
- `.ipynb` files open as notebooks: code and Markdown cells with syntax highlighting, a real Jupyter kernel (any installed kernelspec — Python, R, Julia…) started through a small Python bridge (`pip install ipykernel` is all it needs; the project's `.venv` is used automatically).
- Rich outputs: streams with progress-bar carriage returns, images, SVG, HTML tables (sanitized — no scripts), Markdown, JSON, coloured tracebacks, live `display` updates and `clear_output`.
- Jupyter keys (Shift+Enter, Ctrl+Enter, Alt+Enter, Esc, A / B, D D, M / Y / R, ↑ / ↓), run all / above, interrupt, restart, restart & run all, clear outputs, kernel picker, kernel-powered completions, collapse outputs; saves standard nbformat 4.5 (byte-for-byte compatible with Jupyter).

### Terminal session restore
- Each terminal's scrollback is saved (compressed, on this machine, every 20 s and on quit) and shown again when Gear reopens, under a "restored session · N min ago" divider. Commands that were still running are offered for a re-run. Private terminals are never saved; can be turned off in Settings → Features.

## Code analysis
- Most complex functions across the workspace; hotspots (git churn × complexity); unused exports; circular imports; who imports this file (blast radius) and its local dependencies
- Workspace structural search with `$metavariables`; structural replace in a file; duplicate code across files; call graph of a file (Mermaid + outline); taint check (user input → eval / exec / SQL / innerHTML)
- Refactor: extract function (free variables become parameters, later-used locals become return values; JS/TS and Python), inline variable

## Data & config
- JSONPath queries (filters, slices, recursive descent) on JSON / YAML; validate against a JSON Schema; OpenAPI / Swagger endpoint browser with curl
- Linters for Dockerfiles, GitHub Actions workflows (pinning, script injection, deprecated commands) and Kubernetes manifests
- CSV column statistics, filter rows (`age > 30 and city = London`), sort by column; Markdown table column insert / delete / move / sort
- Paste re-indented to the cursor; barrel index generator; function ⇄ arrow function; duplicate keys in JSON / YAML

## Terminal
- Last output as a table (CSV / JSON / Markdown), JSON from output with JSONPath, compare two commands' output, log viewer filtered by level
- Retry with backoff, watch a command, run in every package folder, commands side by side in split panes, notify when the pane prints a pattern
- scp / rsync helper, tail the active file, serve a folder over HTTP with preview, read-only SQLite browser (new Rust command), docker compose services

## Git
- Stage / unstage / discard selected lines; split the last commit per file; stale branches; largest files in history; add a co-author; oldest TODOs dated by blame
- Clean untracked files with a preview; cherry-pick a range; which branches / tags contain a commit; incoming / outgoing commits
