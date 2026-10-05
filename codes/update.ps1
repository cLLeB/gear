# Pull the latest commits for the current branch and refresh dependencies.
# Run from the repository root:  .\codes\update.ps1
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
$branch = git rev-parse --abbrev-ref HEAD
git fetch origin
if (git status --porcelain) { Write-Warning "Stashing local changes (restore with: git stash pop)"; git stash push -u -m "update auto-stash" | Out-Host }
git pull --ff-only origin $branch
pnpm install
Write-Host "Up to date on $branch. Start with: pnpm tauri dev" -ForegroundColor Green
