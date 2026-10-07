#!/usr/bin/env bash
# Set up Gear for local development on macOS or Linux: installs the toolchain,
# clones (or updates) the repository into a "codes" folder, and installs
# dependencies.
#
#   bash setup-unix.sh                 # ~/codes/gear, default branch below
#   CODES_DIR=~/work BRANCH=main bash setup-unix.sh --dev
#
# Flags: --skip-tools  --extras (debugger / notebook / coverage tools)  --dev (run `pnpm tauri dev`)  --build (build packages)
set -euo pipefail

CODES_DIR="${CODES_DIR:-$HOME/codes}"
BRANCH="${BRANCH:-claude/jolly-mccarthy-5fwubd}"
REPO="${REPO:-https://github.com/cLLeB/gear.git}"
SKIP_TOOLS=0; RUN_DEV=0; RUN_BUILD=0; EXTRAS=0
for a in "$@"; do
  case "$a" in
    --skip-tools) SKIP_TOOLS=1 ;;
    --dev) RUN_DEV=1 ;;
    --build) RUN_BUILD=1 ;;
    --extras) EXTRAS=1 ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

if [ "$SKIP_TOOLS" = 0 ]; then
  step "Checking the toolchain"
  case "$(uname -s)" in
    Darwin)
      xcode-select -p >/dev/null 2>&1 || { echo "Installing Xcode command line tools (a dialog will open)…"; xcode-select --install || true; }
      if ! have brew; then
        echo "Homebrew is needed: https://brew.sh — install it, then re-run." >&2; exit 1
      fi
      have git || brew install git
      have node || brew install node
      ;;
    Linux)
      if have apt-get; then
        sudo apt-get update
        sudo apt-get install -y git curl build-essential file \
          libwebkit2gtk-4.1-dev libappindicator3-dev libglib2.0-dev librsvg2-dev \
          patchelf libgtk-3-dev libssl-dev libsoup-3.0-dev libxdo-dev
      elif have dnf; then
        sudo dnf install -y git curl gcc gcc-c++ make file webkit2gtk4.1-devel openssl-devel \
          libappindicator-gtk3-devel librsvg2-devel libsoup3-devel gtk3-devel patchelf
      elif have pacman; then
        sudo pacman -S --needed --noconfirm git curl base-devel file webkit2gtk-4.1 openssl \
          libappindicator-gtk3 librsvg libsoup3 gtk3 patchelf
      else
        echo "Install the Tauri prerequisites for your distro: https://tauri.app/start/prerequisites/" >&2
      fi
      if ! have node; then
        echo "Installing Node.js LTS via fnm…"
        curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell
        export PATH="$HOME/.local/share/fnm:$PATH"
        eval "$(fnm env)"; fnm install --lts; fnm use lts-latest
      fi
      ;;
  esac
  if ! have cargo; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    # shellcheck disable=SC1091
    . "$HOME/.cargo/env"
  fi
  have pnpm || { have corepack && corepack enable && corepack prepare pnpm@latest --activate; } || npm install -g pnpm
fi

[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
for t in git node pnpm cargo; do have "$t" || { echo "$t is not on PATH; open a new shell and re-run." >&2; exit 1; }; done

step "Getting the code into $CODES_DIR"
mkdir -p "$CODES_DIR"
DIR="$CODES_DIR/gear"
if [ -d "$DIR/.git" ]; then
  cd "$DIR"
  git fetch origin
  if [ -n "$(git status --porcelain)" ]; then
    echo "Local changes found; stashing them first (restore with: git stash pop)."
    git stash push -u -m "setup-unix auto-stash"
  fi
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO" "$DIR"
  cd "$DIR"
fi

step "Installing dependencies (pnpm install)"
pnpm install

if [ "$EXTRAS" = 1 ]; then
  step "Installing optional tools (debugger, notebooks, coverage)"
  # Python debugging (debugpy), Jupyter notebooks (ipykernel) and pytest coverage.
  PY=$(command -v python3 || command -v python || true)
  if [ -n "$PY" ]; then
    "$PY" -m pip install --user --upgrade debugpy ipykernel jupyter_client pytest pytest-cov \
      || "$PY" -m pip install --user --break-system-packages --upgrade debugpy ipykernel jupyter_client pytest pytest-cov \
      || echo "    pip install failed — install debugpy and ipykernel in your project's venv instead"
  else echo "    Python not found; skipped debugpy / ipykernel"; fi
  # Go debugging (Delve), only when Go is installed.
  if have go; then go install github.com/go-delve/delve/cmd/dlv@latest; else echo "    Go not installed; skipping Delve"; fi
  # C / C++ / Rust debugging: gdb 14+ or lldb-dap.
  if ! have gdb && ! have lldb-dap; then
    if [ "$(uname -s)" = Darwin ]; then have brew && brew install llvm || true
    elif have apt-get; then sudo apt-get install -y gdb || true
    elif have dnf; then sudo dnf install -y gdb || true
    elif have pacman; then sudo pacman -S --needed --noconfirm gdb || true; fi
  fi
  cat <<TXT
    Node.js debugging needs js-debug: download js-debug-dap-*.tar.gz from
    https://github.com/microsoft/vscode-js-debug/releases, extract it, and set
    Settings > Features > Debug > js-debug server path to .../js-debug/src/dapDebugServer.js
TXT
fi

printf '\n\033[32mReady: %s\033[0m\n' "$DIR"
cat <<TXT

  Run Gear in development mode:  pnpm tauri dev
  Run the tests:                 pnpm test
  Build packages:                pnpm build:cli && pnpm tauri build
  Update later:                  bash codes/update.sh   (from $DIR)
TXT

if [ "$RUN_BUILD" = 1 ]; then step "Building"; pnpm build:cli && pnpm tauri build
elif [ "$RUN_DEV" = 1 ]; then step "Starting Gear (dev)"; pnpm tauri dev; fi
