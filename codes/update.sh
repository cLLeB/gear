#!/usr/bin/env bash
# Pull the latest commits for the current branch and refresh dependencies.
# Run from the repository root:  bash codes/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
branch="$(git rev-parse --abbrev-ref HEAD)"
git fetch origin
if [ -n "$(git status --porcelain)" ]; then
  echo "Stashing local changes (restore with: git stash pop)"
  git stash push -u -m "update auto-stash"
fi
git pull --ff-only origin "$branch"
pnpm install
echo "Up to date on $branch. Start with: pnpm tauri dev"
