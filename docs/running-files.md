# Running files

Gear resolves "how do I run this file" from three layers. The first match
wins, highest precedence first:

1. **Project** — the `run` block of the workspace's `.gear/settings.json`
2. **Your settings** — Settings → Run
3. **Built in** — the presets shipped with gear

Press ▶ in the tab bar, `F5`, or **Run current file** in the command palette.
Right-clicking a file in the sidebar offers **Run** too. The file is saved
first, then the command is typed into a dedicated **Run** terminal that is
reused for every subsequent run in that space. Re-running while the previous
run is still going interrupts it first.

## Templates

Commands, working directories and environment values are templates:

| Placeholder | Expands to |
|---|---|
| `{file}` | Full path of the file being run |
| `{fileDir}` | Directory containing the file |
| `{fileStem}` | File name without its extension |
| `{workspaceRoot}` | Workspace root, or the file's directory when there is none |

Values substituted into a **command** are shell-quoted automatically, so never
add your own quotes around a placeholder. An unrecognised placeholder is left
verbatim, so a typo shows up in the command rather than becoming `undefined`.

## Project configurations

Add a `run` block to `.gear/settings.json`:

```json
{
  "run": {
    "configs": [
      {
        "name": "Dev server",
        "command": "npm run dev",
        "cwd": "{workspaceRoot}",
        "env": { "PORT": "3000" }
      },
      {
        "name": "Pytest",
        "extensions": ["py"],
        "command": "pytest {file}"
      }
    ]
  }
}
```

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Shown in the run picker and on the ▶ button |
| `command` | yes | Command template |
| `extensions` | no | File types this config runs automatically |
| `id` | no | Stable identifier; derived from `name` when omitted |
| `cwd` | no | Working-directory template. Defaults to `{fileDir}` |
| `env` | no | Variables set in the run terminal before the command |

A config with **no `extensions` never matches automatically** — it is only
available by name from the run picker in the status bar. That keeps a
project's "Dev server" from hijacking ▶ while you have a Python file open.

An invalid entry is dropped and reported; the valid ones still work.

## Workspace trust

A `.gear/settings.json` travels with the repository, so its run configs are
**executable content**. Gear treats them as inert until you approve that
specific workspace once: the first time you run, it shows the exact commands
and environment the project wants to use and asks. Until you approve, only
your own settings and the built-in presets apply.

Approval is per exact workspace root — trusting a repo does not extend to a
nested repository inside it. Revoke from Settings → Run → Trusted workspaces.

## Picking a configuration

The status bar shows the run target. **Auto** matches on the focused file's
type; picking a named configuration pins it for that workspace, and it then
runs regardless of which file is focused. The picker is hidden when only the
built-in presets exist, since there would be nothing to choose between.

## Environment and shells

Environment variables are set as their own lines before the command, using the
syntax of the run terminal's shell (`export` on POSIX shells, `$env:` on
PowerShell, `set` on cmd). They persist in the run terminal between runs, so a
variable from a previous configuration can outlive it — start a fresh Run
terminal if that matters.

`cmd` has no reliable quoting for `set`, which is one more reason project
supplied environments are gated behind workspace trust.
