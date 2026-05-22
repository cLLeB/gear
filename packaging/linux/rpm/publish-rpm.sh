#!/usr/bin/env bash
set -euo pipefail

REPO_DIR=${1:-/var/www/gear/rpm}

mkdir -p "$REPO_DIR"

# Copy .rpm files into repo dir (adjust source path as needed)
# Example: cp ~/Downloads/*.rpm "$REPO_DIR/"

createrepo_c "$REPO_DIR"

echo "RPM repo metadata generated in $REPO_DIR"