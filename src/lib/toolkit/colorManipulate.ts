import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl, type RGB } from "./color";

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Lighten a hex color by a fraction (0-1) of lightness. */
export function lighten(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const hsl = rgbToHsl(rgb);
  return rgbToHex(hslToRgb({ ...hsl, l: clamp01(hsl.l / 100 + amount) * 100 }));
}

/** Darken a hex color by a fraction (0-1) of lightness. */
export function darken(hex: string, amount: number): string {
  return lighten(hex, -amount);
}

/** Blend two hex colors in RGB space; weight 0 = a, 1 = b. */
export function mix(a: string, b: string, weight = 0.5): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return a;
  const w = clamp01(weight);
  const lerp = (x: number, y: number) => Math.round(x + (y - x) * w);
  const out: RGB = { r: lerp(ca.r, cb.r), g: lerp(ca.g, cb.g), b: lerp(ca.b, cb.b) };
  return rgbToHex(out);
}

/** Produce `steps` hex colors evenly spaced from `a` to `b` (inclusive). */
export function gradient(a: string, b: string, steps: number): string[] {
  if (steps <= 1) return [a];
  return Array.from({ length: steps }, (_, i) => mix(a, b, i / (steps - 1)));
}
