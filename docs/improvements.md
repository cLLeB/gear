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
