# Microsoft Store (GearAI)

Store listing: https://apps.microsoft.com/detail/9P479WC1KRQF

`build-msix.ps1` packs a published release into `dist-store/GearAI_<version>.0_x64.msix`
using `AppxManifest.xml` (Store identity, file associations, the `gear` command alias,
tiles). It needs the Windows SDK (`makeappx.exe`) and `gh`.

```powershell
powershell -ExecutionPolicy Bypass -File packaging/msstore/build-msix.ps1 -Version 0.1.13
```

Then in Partner Center: GearAI > Start update > Packages, replace the old `.msix`
with the new one and submit. The Store signs the package, so it is built unsigned.
Store versions must go up every submission.
