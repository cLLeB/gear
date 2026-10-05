// Generate a complete Gear theme from one accent colour, and the schedule
// logic for switching light/dark by time of day.

import type { Theme } from "./types";
import { schemeToTheme, type ForeignScheme } from "./importForeign";
import { mix, parseHex, toHex } from "./contrast";

function hsl(hex: string): [number, number, number] {
  const [r, g, b] = parseHex(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

/** Full terminal + UI theme tinted by `accent` (#rrggbb). */
export function themeFromAccent(accent: string, mode: "dark" | "light", name?: string): Theme {
  const [h, s] = hsl(accent);
  const tint = Math.min(s, 0.35);
  const bg = mode === "dark" ? fromHsl(h, tint * 0.6, 0.09) : fromHsl(h, tint * 0.5, 0.97);
  const fg = mode === "dark" ? fromHsl(h, tint * 0.25, 0.86) : fromHsl(h, tint * 0.4, 0.18);
  const L = mode === "dark" ? 0.62 : 0.42;
  const LB = mode === "dark" ? 0.72 : 0.34;
  const sat = 0.65;
  // Standard hues for red/green/yellow/blue/magenta/cyan, nudged toward the accent.
  const hues = [0, 120, 48, 215, 300, 185].map((x) => x + ((h - x + 540) % 360 - 180) * 0.12);
  const normal = hues.map((x) => fromHsl(x, sat, L));
  const bright = hues.map((x) => fromHsl(x, sat, LB));
  const scheme: ForeignScheme = {
    name: name ?? `Accent ${accent}`,
    background: bg,
    foreground: fg,
    cursor: accent,
    selection: mix(bg, accent, 0.3),
    ansi: [
      mode === "dark" ? mix(bg, fg, 0.15) : mix(bg, fg, 0.85),
      ...normal,
      mode === "dark" ? mix(bg, fg, 0.8) : mix(bg, fg, 0.3),
      mode === "dark" ? mix(bg, fg, 0.4) : mix(bg, fg, 0.55),
      ...bright,
      mode === "dark" ? fg : mix(bg, fg, 0.15),
    ],
  };
  const theme = schemeToTheme(scheme, `accent-${accent.slice(1)}-${mode}-${Date.now()}`);
  // Use the accent itself for primary UI elements.
  for (const v of [theme.variants.dark, theme.variants.light]) {
    if (v?.colors) {
      v.colors.primary = accent;
      v.colors.ring = accent;
      v.colors.sidebarPrimary = accent;
    }
  }
  theme.description = `Generated from ${accent} (${mode})`;
  return theme;
}

/** "07:00-19:00" → is `now` inside the light window? null when unparseable. */
export function inLightWindow(spec: string, now = new Date()): boolean | null {
  const m = /^\s*(\d{1,2}):(\d\d)\s*-\s*(\d{1,2}):(\d\d)\s*$/.exec(spec);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  const t = now.getHours() * 60 + now.getMinutes();
  return start <= end ? t >= start && t < end : t >= start || t < end;
}
