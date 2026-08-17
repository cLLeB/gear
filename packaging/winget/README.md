# Winget (Windows Package Manager)

Gear is published to the WinGet Community Repository as **`cLLeB.Gear`**.

Users install and upgrade with:

```powershell
winget install cLLeB.Gear
winget upgrade cLLeB.Gear
```

## How updates happen

Nothing here is edited by hand. The `winget` job in
[`.github/workflows/publish-packages.yml`](../../.github/workflows/publish-packages.yml)
runs [`vedantmgoyal9/winget-releaser`](https://github.com/vedantmgoyal9/winget-releaser),
which uses [komac](https://github.com/russellbanks/Komac) to:

1. read the `.msi` asset off the GitHub release for the tag,
2. copy the **previous version's manifests** forward — description, tags,
   publisher, product/upgrade codes, install location — so metadata never has to
   be retyped,
3. update `PackageVersion`, `InstallerUrl`, `InstallerSha256`, `ReleaseDate` and
   the release notes,
4. open a PR against [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs)
   from the fork owned by the `WINGET_TOKEN` account.

The published manifests are a three-file set under
`manifests/c/cLLeB/Gear/<version>/` in winget-pkgs — `cLLeB.Gear.yaml` (version),
`cLLeB.Gear.installer.yaml`, `cLLeB.Gear.locale.en-US.yaml`. That set is the
source of truth; this directory is documentation only.

Only the MSI is submitted. The NSIS `*-setup.exe` in the same release would
collide with it as a second x64 installer entry.

## Requirements

| Thing | Why |
| --- | --- |
| `WINGET_TOKEN` repo secret | GitHub PAT with `public_repo` scope, on an account that has a fork of `microsoft/winget-pkgs`. The job fails fast with a clear message if it is missing. |
| A `.msi` asset on the release | The job polls for up to 5 minutes for it to appear before submitting. |
| `cLLeB.Gear` already in winget-pkgs | `winget-releaser` updates existing packages; it cannot create the first version. |

## Re-running a submission by hand

If a winget PR gets rejected by validation, or the job failed while the rest of
the release went out fine, re-submit **without rebuilding anything**:

```bash
gh workflow run publish-packages.yml -R cLLeB/gear \
  -f tag=v0.1.3 \
  -f channels=winget
```

`channels` also accepts `homebrew`, `apt`, `aur`, `rpm`, or `all`.

## Bootstrapping a brand-new package

Only needed once per package identifier — already done for `cLLeB.Gear`, kept
here for reference:

```powershell
winget install wingetcreate
wingetcreate new https://github.com/cLLeB/gear/releases/download/vX.Y.Z/Gear_X.Y.Z_x64_en-US.msi
```

Answer the prompts, then let it open the PR. Every release after that is
automatic.
