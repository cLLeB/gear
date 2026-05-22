# Load Gear signing secrets from project-local .env.build (never committed)
if (Test-Path "$PSScriptRoot\.env.build") {
    Get-Content "$PSScriptRoot\.env.build" | ForEach-Object {
        if ($_ -match '^([^=]+)=(.+)$') {
            [System.Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], "Process")
        }
    }
}

# Pass all arguments through to pnpm tauri so this script works for any
# tauri sub-command: build, dev, info, etc.
# Defaults to "build" when called without arguments (i.e. via tauri:build).
if ($args.Count -gt 0) {
    pnpm exec tauri @args
} else {
    pnpm exec tauri build
}
