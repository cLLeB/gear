# Working on Gear locally

Scripts to set up this repository on your own machine so you don't need a
cloud session to keep working. They install the toolchain, clone the code into
a `codes` folder in your home directory (`~/codes/gear`, or
`C:\Users\<you>\codes\gear` on Windows), check out the development branch and
install dependencies.

## Windows

Download `setup-windows.ps1` (or this whole folder) and run in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1
```

It installs, if missing: Git, Node.js LTS, Rust (rustup), the Visual Studio
C++ Build Tools and WebView2 (via `winget`), then enables pnpm. Options:

| Flag | Effect |
| --- | --- |
| `-CodesDir D:\codes` | clone somewhere else |
| `-Branch main` | use another branch (default: `claude/jolly-mccarthy-5fwubd`) |
| `-SkipTools` | skip installing tools you already have |
| `-Dev` | start Gear in dev mode when done |
| `-Build` | build the `.exe`/`.msi` installers when done |

The first Rust build takes several minutes. If the script says a tool is not on
PATH yet, open a new PowerShell window and run it again.

## macOS / Linux

```bash
bash setup-unix.sh            # add --dev or --build to continue straight on
```

On Linux it installs the Tauri system libraries with apt, dnf or pacman; on
macOS it uses Homebrew and the Xcode command line tools.

## Day to day

From `~/codes/gear`:

```text
pnpm tauri dev                    run the app with hot reload
pnpm test                         run the test suite
pnpm build:cli; pnpm tauri build  build installers (src-tauri/target/release/bundle)
.\codes\update.ps1  /  bash codes/update.sh   pull the latest changes
```

Both setup and update scripts stash uncommitted changes before pulling
(`git stash pop` brings them back) and only fast-forward, so local commits are
never rewritten. To commit and push your own work you need push access to
`cLLeB/gear` (sign in when Git asks, or use the GitHub CLI: `gh auth login`).
