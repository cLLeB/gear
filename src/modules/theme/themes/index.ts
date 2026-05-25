import type { Theme } from "../types";
import { DEFAULT_THEME_ID } from "../types";
import { gearDefault } from "./gear-default";
import { caffeine } from "./caffeine";
import { catppuccin } from "./catppuccin";
import { gruvbox } from "./gruvbox";
import { nord } from "./nord";
import { rosePine } from "./rose-pine";
import { tokyoNight } from "./tokyo-night";
import { claude } from "./claude";
import { sage } from "./sage";
import { tide } from "./tide";

const BUILTIN_THEMES: Theme[] = [
  gearDefault,
  catppuccin,
  gruvbox,
  nord,
  rosePine,
  tokyoNight,
  caffeine,
  claude,
  sage,
  tide,
];

const BUILTIN_MAP = new Map<string, Theme>(
  BUILTIN_THEMES.map((t) => [t.id, t]),
);

export function listBuiltinThemes(): Theme[] {
  return BUILTIN_THEMES;
}

export function getBuiltinTheme(id: string): Theme | undefined {
  return BUILTIN_MAP.get(id);
}

export function getDefaultTheme(): Theme {
  return BUILTIN_MAP.get(DEFAULT_THEME_ID) ?? gearDefault;
}
