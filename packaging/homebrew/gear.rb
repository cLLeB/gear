# Seed copy of the cask, kept for reference and for re-bootstrapping the tap.
#
# THE LIVE CASK IS NOT THIS FILE. It lives at cLLeB/homebrew-gear in
# Casks/gear.rb, and the `homebrew` job in .github/workflows/publish-packages.yml
# rewrites its `version` and `sha256` on every release. Editing this file changes
# nothing for users; changes here must be copied into the tap to take effect.
#
# The version/sha256 below are deliberate placeholders — the release job fills
# them from the published universal DMG.
cask "gear" do
  version "0.0.0"
  sha256 "REPLACE_SHA256"

  url "https://github.com/cLLeB/gear/releases/download/v#{version}/Gear_#{version}_universal.dmg"
  name "Gear"
  desc "AI-native developer terminal built on Tauri and Rust"
  homepage "https://github.com/cLLeB/gear"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "Gear.app"

  zap trash: [
    "~/Library/Application Support/Gear",
    "~/Library/Preferences/app.clleb.gear.plist",
    "~/Library/Logs/Gear",
  ]
end
