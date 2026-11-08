# Builds the Microsoft Store MSIX from the checked-out source.
#
#   powershell -File packaging/msstore/build-msix.ps1            # version from tauri.conf.json
#   powershell -File packaging/msstore/build-msix.ps1 -Version 0.1.13
#   powershell -File packaging/msstore/build-msix.ps1 -AppDir src-tauri/target/release  # skip the build
#
# By default it runs a Store build (--features store-build, no self-updater);
# -AppDir packs an existing Store build instead. The package is left unsigned:
# Partner Center signs Store submissions itself.
param(
    [string]$Version,
    [string]$AppDir,
    [string]$OutDir
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$repo = Resolve-Path "$PSScriptRoot\..\.."
$conf = Get-Content "$repo\src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json
if (-not $Version) { $Version = $conf.version }
if (-not $OutDir) { $OutDir = "$repo\dist-store" }
$Version = $Version -replace '^v', ''
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Store versions must be plain x.y.z, got '$Version'" }

$makeappx = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeappx) { throw "makeappx.exe not found; install the Windows 10/11 SDK" }

$work = Join-Path $env:TEMP "gear-msix-$Version"
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
$pkg = "$work\pkg"
New-Item -ItemType Directory -Force "$pkg\Assets", $OutDir | Out-Null

# Binaries
if (-not $AppDir) {
    # The Store build leaves out the self-updater (Store policy), so the
    # GitHub release binaries can't be reused here.
    $storeConf = "$work\tauri.store.conf.json"
    [IO.File]::WriteAllText($storeConf, '{"bundle":{"createUpdaterArtifacts":false}}')
    Push-Location $repo
    try {
        node scripts/tauri.mjs build --no-bundle --config $storeConf -- --features store-build
        if ($LASTEXITCODE) { throw "store build failed" }
    } finally { Pop-Location }
    $AppDir = "$repo\src-tauri\target\release"
}
$cli = "$repo\src-tauri\binaries\gear-cli-x86_64-pc-windows-msvc.exe"
if (-not (Test-Path "$AppDir\gear-cli.exe") -and (Test-Path $cli)) { Copy-Item $cli "$AppDir\gear-cli.exe" }
foreach ($exe in "gear.exe", "gear-cli.exe") {
    if (-not (Test-Path "$AppDir\$exe")) { throw "$exe missing from $AppDir" }
    Copy-Item "$AppDir\$exe" $pkg
}

# Tile and logo assets
$icons = "$repo\src-tauri\icons"
foreach ($f in "StoreLogo", "Square44x44Logo", "Square71x71Logo", "Square150x150Logo", "Square310x310Logo") {
    Copy-Item "$icons\$f.png" "$pkg\Assets\"
}
function New-CenteredImage([int]$w, [int]$h, [int]$size, [string]$path) {
    $src = [System.Drawing.Image]::FromFile("$icons\icon.png")
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($src, [int](($w - $size) / 2), [int](($h - $size) / 2), $size, $size)
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose(); $src.Dispose()
}
New-CenteredImage 310 150 100 "$pkg\Assets\Wide310x150Logo.png"
New-CenteredImage 620 300 200 "$pkg\Assets\SplashScreen.png"

# Manifest
$types = ($conf.bundle.fileAssociations | ForEach-Object { $_.ext } | Sort-Object -Unique |
    ForEach-Object { "              <uap:FileType>.$($_.ToLower())</uap:FileType>" }) -join "`r`n"
$manifest = (Get-Content "$PSScriptRoot\AppxManifest.xml" -Raw).
    Replace("{{VERSION}}", "$Version.0").
    Replace("{{FILE_TYPES}}", $types)
[IO.File]::WriteAllText("$pkg\AppxManifest.xml", $manifest, (New-Object Text.UTF8Encoding $false))

$out = Join-Path $OutDir "GearAI_${Version}.0_x64.msix"
$log = & $makeappx.FullName pack /d $pkg /p $out /o
if ($LASTEXITCODE) { $log | Write-Host; throw "makeappx failed" }
Remove-Item $work -Recurse -Force
Write-Host "Built $out"
