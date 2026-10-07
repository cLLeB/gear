<#
.SYNOPSIS
  Set up Gear for local development on Windows: installs the toolchain,
  clones (or updates) the repository into a "codes" folder, and installs
  dependencies.

.EXAMPLE
  # From any PowerShell window (Run as Administrator is NOT required):
  powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1

.EXAMPLE
  # Choose another folder / branch, then start the app straight away:
  .\setup-windows.ps1 -CodesDir D:\codes -Branch main -Dev
#>
param(
  [string]$CodesDir = (Join-Path $HOME "codes"),
  [string]$Branch = "claude/jolly-mccarthy-5fwubd",
  [string]$Repo = "https://github.com/cLLeB/gear.git",
  [switch]$SkipTools,   # don't install Git/Node/Rust/Build Tools
  [switch]$Extras,      # also install the tools the debugger / notebooks / tests use
  [switch]$Dev,         # run `pnpm tauri dev` when done
  [switch]$Build        # build the installer (.exe/.msi) when done
)

$ErrorActionPreference = "Stop"
function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
              [Environment]::GetEnvironmentVariable("Path", "User") + ";" +
              (Join-Path $HOME ".cargo\bin")
}
function Winget-Install($id, $extra = @()) {
  Write-Host "    installing $id ..."
  winget install --id $id -e --accept-source-agreements --accept-package-agreements --silent @extra | Out-Host
}

if (-not $SkipTools) {
  Step "Checking the toolchain"
  if (-not (Have winget)) {
    Write-Warning "winget is missing. Install 'App Installer' from the Microsoft Store, or install Git, Node.js 20+, Rust and the VS C++ Build Tools yourself, then re-run with -SkipTools."
  } else {
    if (-not (Have git))   { Winget-Install "Git.Git" }
    if (-not (Have node))  { Winget-Install "OpenJS.NodeJS.LTS" }
    if (-not (Have cargo) -and -not (Test-Path (Join-Path $HOME ".cargo\bin\cargo.exe"))) { Winget-Install "Rustlang.Rustup" }
    # Rust on Windows links with the MSVC toolchain from the VS Build Tools.
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    $hasVc = (Test-Path $vswhere) -and (& $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
    if (-not $hasVc) {
      Winget-Install "Microsoft.VisualStudio.2022.BuildTools" @("--override", "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended")
    }
    # WebView2 ships with Windows 11; this is a no-op there.
    Winget-Install "Microsoft.EdgeWebView2Runtime"
    Refresh-Path
  }
  if (Have rustup) { rustup default stable | Out-Host }
  Step "Enabling pnpm"
  if (-not (Have pnpm)) {
    if (Have corepack) { corepack enable; corepack prepare pnpm@latest --activate } else { npm install -g pnpm }
    Refresh-Path
  }
}

foreach ($tool in "git", "node", "pnpm", "cargo") {
  if (-not (Have $tool)) { throw "$tool is not on PATH yet. Open a NEW PowerShell window and run this script again." }
}

Step "Getting the code into $CodesDir"
New-Item -ItemType Directory -Force -Path $CodesDir | Out-Null
$dir = Join-Path $CodesDir "gear"
if (Test-Path (Join-Path $dir ".git")) {
  Push-Location $dir
  git fetch origin
  $dirty = git status --porcelain
  if ($dirty) { Write-Warning "You have local changes; stashing them before updating (restore with: git stash pop)."; git stash push -u -m "setup-windows auto-stash" | Out-Host }
  git checkout $Branch
  git pull --ff-only origin $Branch
} else {
  git clone --branch $Branch $Repo $dir
  Push-Location $dir
}

Step "Installing dependencies (pnpm install)"
pnpm install

if ($Extras) {
  Step "Installing optional tools (debugger, notebooks, coverage)"
  # Python debugging (debugpy), Jupyter notebooks (ipykernel) and pytest coverage.
  $py = @("py", "python", "python3") | Where-Object { Have $_ } | Select-Object -First 1
  if (-not $py -and (Have winget)) { Winget-Install "Python.Python.3.12"; Refresh-Path; $py = @("py", "python") | Where-Object { Have $_ } | Select-Object -First 1 }
  if ($py) { & $py -m pip install --user --upgrade debugpy ipykernel jupyter_client pytest pytest-cov | Out-Host } else { Write-Warning "Python not found; skipped debugpy / ipykernel." }
  # Go debugging (Delve), only when Go is installed.
  if (Have go) { go install github.com/go-delve/delve/cmd/dlv@latest | Out-Host } else { Write-Host "    Go not installed; skipping Delve (install Go, then: go install github.com/go-delve/delve/cmd/dlv@latest)" }
  # C / C++ / Rust debugging: lldb-dap ships with LLVM.
  if (-not (Have lldb-dap) -and (Have winget)) { Winget-Install "LLVM.LLVM" }
  Write-Host @"
    Node.js debugging needs js-debug: download js-debug-dap-*.tar.gz from
    https://github.com/microsoft/vscode-js-debug/releases, extract it, and set
    Settings > Features > Debug > js-debug server path to ...\js-debug\src\dapDebugServer.js
"@
}

Write-Host "`nReady: $dir" -ForegroundColor Green
Write-Host @"

  Run Gear in development mode:   pnpm tauri dev
  Run the tests:                  pnpm test
  Build the installer (.exe/.msi): pnpm build:cli; pnpm tauri build
  Update later:                   .\codes\update.ps1   (from $dir)
"@

if ($Build) { Step "Building the installer"; pnpm build:cli; pnpm tauri build; Write-Host "Installers: $dir\src-tauri\target\release\bundle" -ForegroundColor Green }
elseif ($Dev) { Step "Starting Gear (dev)"; pnpm tauri dev }
Pop-Location
