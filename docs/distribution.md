# Distribution Setup Guide

Gear is distributed via GitHub Releases (primary) plus four package manager channels.
The `publish-packages.yml` workflow handles all four automatically after each release build.

---

## How the pipeline works

```
push to main
  └─► release-please opens PR
        └─► you merge PR
              └─► tag v0.x.x created
                    └─► release.yml builds macOS (universal) + Linux + Windows
                          └─► publish-packages.yml runs (all 4 channels)
```

---

## One-time setup per channel

### 1. Winget (Windows Package Manager)

**Goal:** `winget install cLLeB.Gear`

**Create the PAT:**
1. Go to GitHub → Settings → Developer Settings → Personal Access Tokens → Fine-grained
2. Grant `contents: write` and `pull-requests: write` on `microsoft/winget-pkgs`
3. Add as repo secret: `WINGET_TOKEN`

**First submission (manual):**
Winget requires an initial manual PR for new packages.
```powershell
# Install winget-create
winget install Microsoft.WingetCreate

# Generate manifest from the v0.1.0 release MSI
wingetcreate new https://github.com/cLLeB/gear/releases/download/v0.1.0/Gear_0.1.0_x64_en-US.msi

# Follow prompts, then submit PR to microsoft/winget-pkgs
```
After the first PR is approved, subsequent releases are automated via `publish-packages.yml`.

**Template:** `packaging/winget/manifest.template.yaml` — reference only, `winget-releaser` generates real manifests.

---

### 2. Homebrew Cask (macOS)

**Goal:** `brew install --cask cLLeB/gear/gear`

> Getting into `homebrew/homebrew-cask` (no tap prefix) requires ~75 GitHub stars and
> a review process. A personal tap works immediately and is upgraded later.

**Create the tap repo:**
1. Create a new GitHub repo named **`homebrew-gear`** under `cLLeB`
2. Inside it, create `Casks/gear.rb` — copy from `packaging/homebrew/gear.rb`
3. Enable GitHub Pages if you want a tap homepage (optional)

**Create the PAT:**
1. GitHub → Settings → Developer Settings → Personal Access Tokens
2. Grant `contents: write` on `cLLeB/homebrew-gear`
3. Add as repo secret: `HOMEBREW_TAP_TOKEN`

**Users install with:**
```bash
brew tap cLLeB/gear
brew install --cask gear
```

**Cask template:** `packaging/homebrew/gear.rb` — this file is committed to `cLLeB/homebrew-gear` as `Casks/gear.rb`. The CI updates it on each release.

---

### 3. APT repository (Debian / Ubuntu)

**Goal:**
```bash
curl -fsSL https://portfolio.kyere.me/gear-packages/apt/key.gpg | sudo tee /etc/apt/keyrings/gear.gpg > /dev/null
echo "deb [signed-by=/etc/apt/keyrings/gear.gpg] https://portfolio.kyere.me/gear-packages/apt stable main" \
  | sudo tee /etc/apt/sources.list.d/gear.list
sudo apt update && sudo apt install gear
```

**Create the packages repo:**
1. Create a new GitHub repo named **`gear-packages`** under `cLLeB`
2. Enable GitHub Pages → Source: `main` branch, root `/`
3. Create the folder structure:
   ```
   gear-packages/
   ├── apt/
   │   └── pool/main/   (empty, CI fills it)
   └── rpm/             (empty, CI fills it)
   ```

**Generate GPG signing key (run once locally):**
```bash
# Generate key
gpg --batch --gen-key <<EOF
Key-Type: RSA
Key-Length: 4096
Name-Real: Gear APT Repository
Name-Email: gear-apt@users.noreply.github.com
Expire-Date: 0
%no-protection
EOF

# Get the fingerprint
gpg --list-keys gear-apt@users.noreply.github.com

# Export private key (store as secret)
gpg --export-secret-keys FINGERPRINT | base64

# Export public key (commit into gear-packages repo)
gpg --export --armor FINGERPRINT > key.gpg
# commit key.gpg into gear-packages/apt/key.gpg
```

**Add repo secrets:**
| Secret | Value |
|--------|-------|
| `GEAR_APT_GPG_KEY` | Output of the base64 export above |
| `GEAR_APT_GPG_FP` | GPG key fingerprint (40-char hex) |
| `PACKAGES_TOKEN` | GitHub PAT with `contents: write` on `cLLeB/gear-packages` |

---

### 4. RPM repository (Fedora / RHEL / openSUSE)

**Goal:**
```bash
sudo dnf config-manager --add-repo https://portfolio.kyere.me/gear-packages/rpm
sudo dnf install gear
```

**Uses the same `gear-packages` repo and `PACKAGES_TOKEN` secret as APT.**
No GPG setup needed for basic RPM repos (signing is optional but recommended for production).

---

## Secrets summary

Add these in: **GitHub → your repo → Settings → Secrets and variables → Actions**

| Secret | Used by | How to get |
|--------|---------|------------|
| `TAURI_SIGNING_PRIVATE_KEY` | Release builds | Already set |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Release builds | Already set |
| `WINGET_TOKEN` | Winget job | PAT on `microsoft/winget-pkgs` |
| `HOMEBREW_TAP_TOKEN` | Homebrew job | PAT on `cLLeB/homebrew-gear` |
| `GEAR_APT_GPG_KEY` | APT job | GPG private key (base64) |
| `GEAR_APT_GPG_FP` | APT job | GPG fingerprint |
| `PACKAGES_TOKEN` | APT + RPM jobs | PAT on `cLLeB/gear-packages` |

---

## Rollout order (recommended)

1. **Winget** — zero infrastructure, just a PAT + initial manual PR
2. **Homebrew** — create one repo, one PAT
3. **APT** — create one repo, generate GPG key, store 3 secrets
4. **RPM** — reuses the same repo and PAT as APT

Once all secrets are set, the entire pipeline is automatic on every release merge.
