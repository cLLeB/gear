export type WallpaperCategory = "dark" | "space" | "nature" | "abstract" | "minimal" | "neon";

export interface BuiltinWallpaper {
  id: string;
  label: string;
  category: WallpaperCategory;
  file: string;
}

export const BUILTIN_WALLPAPERS: BuiltinWallpaper[] = [
  // Dark / moody
  { id: "dark-1", label: "Starry Peaks", category: "dark", file: "dark-1.jpg" },
  { id: "dark-2", label: "Mountain Dusk", category: "dark", file: "dark-2.jpg" },
  { id: "dark-3", label: "Storm Light", category: "dark", file: "dark-3.jpg" },
  { id: "dark-4", label: "Deep Forest", category: "dark", file: "dark-4.jpg" },
  { id: "dark-5", label: "Twilight Vale", category: "dark", file: "dark-5.jpg" },
  // Space / cosmos
  { id: "space-1", label: "Nebula Drift", category: "space", file: "space-1.jpg" },
  { id: "space-2", label: "Galaxy Core", category: "space", file: "space-2.jpg" },
  { id: "space-3", label: "Cosmic Veil", category: "space", file: "space-3.jpg" },
  { id: "space-4", label: "Starfield", category: "space", file: "space-4.jpg" },
  // Nature
  { id: "nature-1", label: "Aerial Greens", category: "nature", file: "nature-1.jpg" },
  { id: "nature-2", label: "Pine Canopy", category: "nature", file: "nature-2.jpg" },
  { id: "nature-3", label: "Misty Path", category: "nature", file: "nature-3.jpg" },
  { id: "nature-4", label: "Cascade Falls", category: "nature", file: "nature-4.jpg" },
  { id: "nature-5", label: "Turquoise Shore", category: "nature", file: "nature-5.jpg" },
  // Abstract
  { id: "abstract-1", label: "Liquid Hues", category: "abstract", file: "abstract-1.jpg" },
  { id: "abstract-2", label: "Ink Bloom", category: "abstract", file: "abstract-2.jpg" },
  { id: "abstract-3", label: "Aurora Swirl", category: "abstract", file: "abstract-3.jpg" },
  { id: "abstract-4", label: "Prism Burst", category: "abstract", file: "abstract-4.jpg" },
  // Minimal / geometric
  { id: "minimal-1", label: "Clean Room", category: "minimal", file: "minimal-1.jpg" },
  { id: "minimal-2", label: "Icy Blue", category: "minimal", file: "minimal-2.jpg" },
  { id: "minimal-3", label: "Warm Curve", category: "minimal", file: "minimal-3.jpg" },
  { id: "minimal-4", label: "Soft Gradient", category: "minimal", file: "minimal-4.jpg" },
  // Neon / city night
  { id: "neon-1", label: "Tokyo Rain", category: "neon", file: "neon-1.jpg" },
  { id: "neon-2", label: "City Lights", category: "neon", file: "neon-2.jpg" },
  { id: "neon-3", label: "Night Skyline", category: "neon", file: "neon-3.jpg" },
];

export const WALLPAPER_CATEGORIES: { id: WallpaperCategory | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "dark", label: "Dark" },
  { id: "space", label: "Space" },
  { id: "nature", label: "Nature" },
  { id: "abstract", label: "Abstract" },
  { id: "minimal", label: "Minimal" },
  { id: "neon", label: "Neon" },
];

export function getWallpaperUrl(file: string): string {
  return `/wallpapers/${file}`;
}

export function getWallpaperById(id: string): BuiltinWallpaper | undefined {
  return BUILTIN_WALLPAPERS.find((w) => w.id === id);
}
