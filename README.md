# Gear

**A fast, AI-powered developer terminal for macOS, Linux, and Windows.**

Gear is a native desktop application built on [Tauri 2](https://tauri.app) (Rust backend) and React 19 (TypeScript frontend). It aims to be a lean, daily-driver terminal , not a VS Code replacement. Every feature ships because it makes the terminal genuinely more useful, not to fill a feature matrix.

---

## Features

- **Multi-tab terminal** — open as many tabs as you need, drag to reorder
- **Split panes** — split any terminal horizontally or vertically (Cmd/Ctrl+D / Cmd/Ctrl+Shift+D)
- **AI integration** — chat with Claude, OpenAI, Gemini, Groq, and more; inline completions in the editor; ask AI about terminal selections
- **File explorer** — full tree with multi-select, rename, delete, create, and drag-to-attach to AI
- **Code editor** — CodeMirror 6, syntax highlighting for 100+ languages, Vim mode, find & replace, code folding
- **Preview panel** — embedded browser for local dev servers with port presets and DevTools toggle
- **Git panel** — branch list/create/checkout, diff viewer, commit history, stash management
- **Session persistence** — terminal sessions restore across relaunches
- **Settings import/export** — JSON backup and restore of all preferences
- **Per-workspace config** — `.gear/settings.json` overrides global preferences per project
- **Keyboard shortcuts** — fully customisable; shown in the shortcuts dialog (Cmd/Ctrl+K)

---

## Philosophy

Gear is intentionally narrow in scope. It does not include:

- Extension marketplace
- Remote development / SSH manager
- Docker integration
- Visual debugger
- HTTP client
- Voice input
- Real-time collaboration

If VS Code already does something better, Gear doesn't try to compete. If a feature makes the terminal itself faster or smarter, it belongs here.

---


## Installation

### macOS

```bash
brew install --cask clleb/gear/gear
```

### Windows

```powershell
winget install cLLeB.Gear
```

### Linux

```bash
curl -fsSL https://gear.kyere.me/install.sh | sh
```

Auto-detects your distro:

| Distro | Method |
|--------|--------|
| Arch / Manjaro / EndeavourOS | `yay -S gear-terminal-bin` (AUR) |
| Ubuntu / Debian / Mint / Pop | installs `.deb` via `dpkg` |
| Fedora / RHEL / Rocky / Alma | installs `.rpm` via `dnf` |
| openSUSE | installs `.rpm` via `zypper` |
| Everything else | installs AppImage to `~/.local/bin` |

Or grab a package directly from the [releases page](https://github.com/cLLeB/gear/releases).

---

## Requirements

| Tool                       | Version                                                     |
| -------------------------- | ----------------------------------------------------------- |
| [Node.js](https://nodejs.org) | 20+                                                         |
| [pnpm](https://pnpm.io)       | 9+                                                          |
| [Rust](https://rustup.rs)     | 1.80+ (stable)                                              |
| Tauri prerequisites        | See[Tauri setup guide](https://tauri.app/start/prerequisites/) |

---

## Development

### 1. Install dependencies

```bash
pnpm install
```

### 2. Start the dev server

```bash
pnpm tauri dev
```

This starts the Vite frontend and the Tauri shell together. Hot-reloading is enabled for the frontend.

### 3. Frontend only (no native shell)

```bash
pnpm dev
```

Useful for rapidly iterating on UI components that don't need Tauri APIs.

---

## Building

### Full release build

```bash
pnpm tauri:build
```

On Windows this runs `build.ps1` via PowerShell. The output is placed in `src-tauri/target/release/bundle/`.

### Frontend build only

```bash
pnpm build
```

---

## Distribution

We track Windows Winget, macOS Homebrew Cask, and Linux APT/RPM options in `docs/distribution.md`.

---

## Project structure

```
gear/
├── src/                   # React frontend (TypeScript)
│   ├── app/               # Root App component, global wiring
│   ├── components/        # Shared UI primitives and AI elements
│   └── modules/           # Feature modules (terminal, editor, AI, git, …)
├── src-tauri/             # Rust backend (Tauri 2)
│   └── src/modules/       # Rust feature modules (fs, git, pty, …)
├── public/                # Static assets
└── pnpm-workspace.yaml    # pnpm workspace config
```

---

## Tech stack

| Layer    | Technology                                          |
| -------- | --------------------------------------------------- |
| Shell    | [Tauri 2](https://tauri.app) + Rust                    |
| Frontend | React 19, TypeScript, Vite                          |
| Terminal | [xterm.js 6](https://xtermjs.org)                      |
| Editor   | [CodeMirror 6](https://codemirror.net)                 |
| AI       | [Vercel AI SDK](https://sdk.vercel.ai), multi-provider |
| Styling  | Tailwind CSS v4, shadcn/ui                          |
| State    | Zustand                                             |
