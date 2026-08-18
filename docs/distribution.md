# Distribution Setup Guide

Gear is distributed via GitHub Releases (primary) plus five package manager
channels: Winget, Homebrew, APT, AUR, and RPM. The `publish-packages.yml`
workflow handles all five automatically after each release build.

---

## How the pipeline works

Merging the release PR is the only manual step. Everything below it runs inside
a **single** GitHub Actions run:

```
push to main
  └─► release-please opens/updates the release PR
        └─► you merge it
              └─► release-please tags v0.x.x and creates the GitHub release
                    └─► release.yml   (called)  builds macOS universal + Linux + Windows
                          └─► publish-packages.yml (called)  winget · homebrew · apt · aur · rpm
```

### Why the workflows are *called*, not triggered

release-please tags the repo using `GITHUB_TOKEN`, and GitHub deliberately
refuses to start new workflow runs from `GITHUB_TOKEN`-created events. So
`release.yml`'s `push: tags` trigger **never fires for an automated release** —
v0.1.2 had to be built by hand with `workflow_dispatch` for exactly this reason.

Rather than introduce a PAT to work around it, `release-please.yml` invokes both
workflows with `uses:` when its `release_created` output is `true`. A called
workflow is part of the caller's run, so no new event is needed and the chain
never breaks.

Both workflows remain independently usable: `release.yml` still runs on a
hand-pushed tag, and both accept a `workflow_dispatch` with an explicit tag.

### Re-running one channel

If a single channel fails — a rejected winget PR, a transient AUR push error —
re-publish just that one against an existing tag, with no rebuild:

```bash
gh workflow run publish-packages.yml -R cLLeB/gear \
  -f tag=v0.1.3 \
  -f channels=winget
```

`channels` accepts `all` (default), `winget`, `homebrew`, `apt`, `aur`, or `rpm`.

### Rebuilding a release

```bash
gh workflow run release.yml -R cLLeB/gear -f tag=v0.1.3
```

---

## One-time setup per channel

### 1. Winget (Windows Package Manager)

**Goal:** `winget install cLLeB.Gear`

**Create the PAT:**
1. Go to GitHub → Settings → Developer Settings → Personal Access Tokens → **Tokens (classic)**
2. Grant the **`public_repo`** scope
3. Add as repo secret: `WINGET_TOKEN`

> The token must be able to **push to your fork, `cLLeB/winget-pkgs`** — komac
> creates its branch there and only then opens the PR against
> `microsoft/winget-pkgs`. Scoping a fine-grained token to `microsoft/winget-pkgs`
> alone does not work.
>
> **Watch the expiry.** komac reports a dead token as
> `cLLeB does not have the correct permissions to execute CreateRef`, which reads
> like a scope problem but usually means the PAT expired. The `Validate
> WINGET_TOKEN` step in the workflow distinguishes the two and prints the token's
> scopes and expiry date.

**Status:** done. `cLLeB.Gear` is live in winget-pkgs and every release since
0.1.1 has been submitted automatically.

The initial manual `wingetcreate new` PR that winget requires for a brand-new
package has already been made, so nothing manual is left. On each release,
`winget-releaser` copies the previous version's manifests forward via komac and
opens the PR — only the MSI is submitted, since the NSIS `setup.exe` would
collide with it as a second x64 installer.

The job fails fast with an explicit message if `WINGET_TOKEN` is unset, and
waits up to 5 minutes for the `.msi` asset to appear on the release before
submitting.

**See:** [`packaging/winget/README.md`](../packaging/winget/README.md) for the
full flow, the re-submission command, and the one-time bootstrap steps.

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

The rpm job runs after apt because both push to the same repo; it commits before
`git pull --rebase` so a dirty tree from `createrepo_c` cannot abort the rebase.

---

### 5. AUR (Arch User Repository)

**Goal:** `yay -S gear-terminal-bin`

The `aur` job rewrites `PKGBUILD` and `.SRCINFO` for the new version — sourcing
the release `.deb` and extracting it — then pushes to
`ssh://aur@aur.archlinux.org/gear-terminal-bin.git`.

**Create the SSH key (run once locally):**
```bash
ssh-keygen -t ed25519 -f ~/.ssh/aur -C "aur@gear"
# Add the PUBLIC key (~/.ssh/aur.pub) to your AUR account:
#   https://aur.archlinux.org/account  →  SSH Public Key
# Add the PRIVATE key (~/.ssh/aur) as repo secret: AUR_SSH_KEY
```

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
| `AUR_SSH_KEY` | AUR job | Private SSH key registered on the AUR account |

All seven are set. The entire pipeline is automatic on every release merge.

---

## Rollout order (recommended)

For anyone setting this up from scratch, cheapest first:

1. **Winget** — zero infrastructure, just a PAT + initial manual PR
2. **Homebrew** — create one repo, one PAT
3. **AUR** — one SSH key, no repo to host
4. **APT** — create one repo, generate GPG key, store 3 secrets
5. **RPM** — reuses the same repo and PAT as APT
