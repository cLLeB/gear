export { ThemeProvider, useTheme } from "./ThemeProvider";
export type { Theme, ThemeMode, ThemeColors, ThemeVariant, TerminalPalette } from "./types";
export { DEFAULT_THEME_ID } from "./types";
export { applyTheme } from "./applyTheme";
export { validateTheme } from "./validateTheme";
export {
  storeBgImage,
  getBgImage,
  deleteBgImage,
} from "./bgImageStore";
export {
  loadCustomThemes,
  saveCustomTheme,
  deleteCustomTheme,
  onCustomThemesChange,
} from "./customThemes";
export {
  starterTheme,
  parseThemeFile,
  downloadThemeFile,
  emitThemeEdit,
  onThemeEdit,
  THEME_FILE_EXT,
} from "./themeFiles";
export { listBuiltinThemes, getBuiltinTheme, getDefaultTheme } from "./themes";
export { SurfaceLayer, BG_OPACITY_RENDER_FACTOR } from "./SurfaceLayer";
export {
  BUILTIN_WALLPAPERS,
  WALLPAPER_CATEGORIES,
  getWallpaperUrl,
  getWallpaperById,
} from "./builtinWallpapers";
export type { BuiltinWallpaper, WallpaperCategory } from "./builtinWallpapers";
export {
  BUILTIN_GRADIENTS,
  GRADIENT_CATEGORIES,
  getGradientById,
} from "./builtinGradients";
export type { BuiltinGradient, GradientCategory } from "./builtinGradients";
