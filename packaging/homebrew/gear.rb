cask "gear" do
  version "0.1.0"
  sha256 "<SHA256>"

  url "https://github.com/cLLeB/gear/releases/download/v#{version}/Gear_#{version}_aarch64.dmg"
  name "Gear"
  desc "AI-powered developer terminal"
  homepage "https://github.com/cLLeB/gear"

  app "Gear.app"

  zap trash: [
    "~/Library/Application Support/Gear",
    "~/Library/Preferences/app.clleb.gear.plist",
    "~/Library/Logs/Gear"
  ]
end
