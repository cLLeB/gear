# Distribution Guide

This guide covers packaging options we want to support next:

- **Windows:** Winget
- **macOS:** Homebrew Cask
- **Linux:** APT repository, RPM repository

All of these use the artifacts produced by the GitHub Release workflow.

---

## Winget (Windows)

**Goal:** `winget install Gear`

### What you need
- GitHub release URL for the `.msi` or `.exe` (recommended: `.msi`).
- SHA256 checksum for the installer.
- Publisher name, app ID, and homepage.

### Files
- Templates live in `packaging/winget/`.
- Update the template with the version and hashes for each release.

### Steps
1. Download the installer from the release and compute SHA256.
2. Update the Winget manifest(s) in `packaging/winget/`.
3. Submit a PR to `microsoft/winget-pkgs`.

---

## Homebrew Cask (macOS)

**Goal:** `brew install --cask gear`

### What you need
- GitHub release URL for the `.dmg`.
- SHA256 checksum for the `.dmg`.

### Files
- Template cask: `packaging/homebrew/gear.rb`.

### Steps
1. Download the `.dmg` from the release and compute SHA256.
2. Update the cask template with the new version and SHA.
3. Submit a PR to `Homebrew/homebrew-cask`.

---

## APT repository (Linux: Debian/Ubuntu)

**Goal:** `sudo apt install gear`

### What you need
- `.deb` artifacts from GitHub Releases.
- A hosting location for the APT repo (S3, GitHub Pages, etc.).

### Files
- Publish script template: `packaging/linux/apt/publish-apt.sh`.

### Steps
1. Upload the `.deb` to your repo host.
2. Run the publish script to generate `Packages.gz` and `Release` metadata.
3. Document install instructions for users (add apt source + key).

---

## RPM repository (Linux: Fedora/RHEL)

**Goal:** `sudo dnf install gear`

### What you need
- `.rpm` artifacts from GitHub Releases.
- A hosting location for the RPM repo.

### Files
- Publish script template: `packaging/linux/rpm/publish-rpm.sh`.

### Steps
1. Upload the `.rpm` to your repo host.
2. Run the publish script to create repodata.
3. Document the `.repo` config for users.

---

## Release checklist (per version)

- [ ] Upload all release artifacts to GitHub Releases.
- [ ] Compute SHA256 for `.msi`, `.dmg`, `.deb`, `.rpm`.
- [ ] Update Winget/Homebrew templates with the new version/hashes.
- [ ] Publish `.deb` and `.rpm` to your Linux repos.
- [ ] Announce install commands on the website.
