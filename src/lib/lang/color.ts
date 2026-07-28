// A color engine for the theming system: parse the color notations that appear
// in themes and CSS (`#rgb`, `#rrggbb(aa)`, `rgb()/rgba()`, `hsl()/hsla()`),
// convert between RGB and HSL, and do the operations a theme editor needs —
// lighten/darken a swatch, mix two colors, and (crucially for accessibility)
// compute the WCAG contrast ratio between a foreground and background so the UI
// can warn when text would be unreadable. The math follows the sRGB / WCAG 2.1
// definitions so results line up with design tools.

export interface RGBA {
  r: number; // 0-255
  g: number;
  b: number;
  a: number; // 0-1
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
const round = (v: number) => Math.round(v);

/** Parse a color string into RGBA, or null if unrecognized. */
export function parseColor(input: string): RGBA | null {
  const s = input.trim().toLowerCase();

  if (s.startsWith("#")) return parseHex(s);
  const rgb = /^rgba?\(([^)]+)\)$/.exec(s);
  if (rgb) return parseRgbFunc(rgb[1]);
  const hsl = /^hsla?\(([^)]+)\)$/.exec(s);
  if (hsl) return parseHslFunc(hsl[1]);
  return null;
}

function parseHex(s: string): RGBA | null {
  const hex = s.slice(1);
  const expand = (h: string) => parseInt(h.length === 1 ? h + h : h, 16);
  if (hex.length === 3 || hex.length === 4) {
    return {
      r: expand(hex[0]), g: expand(hex[1]), b: expand(hex[2]),
      a: hex.length === 4 ? expand(hex[3]) / 255 : 1,
    };
  }
  if (hex.length === 6 || hex.length === 8) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }
  return null;
}

function parseRgbFunc(body: string): RGBA | null {
  const parts = body.split(",").map((p) => p.trim());
  if (parts.length < 3) return null;
  return {
    r: clamp(round(parseFloat(parts[0])), 0, 255),
    g: clamp(round(parseFloat(parts[1])), 0, 255),
    b: clamp(round(parseFloat(parts[2])), 0, 255),
    a: parts[3] !== undefined ? clamp(parseFloat(parts[3]), 0, 1) : 1,
  };
}

function parseHslFunc(body: string): RGBA | null {
  const parts = body.split(",").map((p) => p.trim());
  if (parts.length < 3) return null;
  const h = parseFloat(parts[0]);
  const sPct = parseFloat(parts[1]) / 100;
  const lPct = parseFloat(parts[2]) / 100;
  const { r, g, b } = hslToRgb(h, sPct, lPct);
  return { r, g, b, a: parts[3] !== undefined ? clamp(parseFloat(parts[3]), 0, 1) : 1 };
}

/** Format an RGBA as a hex string (#rrggbb, or #rrggbbaa when translucent). */
export function toHex(color: RGBA): string {
  const h = (v: number) => clamp(round(v), 0, 255).toString(16).padStart(2, "0");
  const base = `#${h(color.r)}${h(color.g)}${h(color.b)}`;
  return color.a < 1 ? base + h(color.a * 255) : base;
}

// --- Conversions -----------------------------------------------------------

export interface HSL {
  h: number; // 0-360
  s: number; // 0-1
  l: number; // 0-1
}

/** Convert 0-255 RGB to HSL. */
export function rgbToHsl(r: number, g: number, b: number): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
    case gn: h = (bn - rn) / d + 2; break;
    default: h = (rn - gn) / d + 4; break;
  }
  return { h: h * 60, s, l };
}

/** Convert HSL to 0-255 RGB. */
export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h = ((h % 360) + 360) % 360;
  if (s === 0) { const v = round(l * 255); return { r: v, g: v, b: v }; }

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (h < 60) [rp, gp, bp] = [c, x, 0];
  else if (h < 120) [rp, gp, bp] = [x, c, 0];
  else if (h < 180) [rp, gp, bp] = [0, c, x];
  else if (h < 240) [rp, gp, bp] = [0, x, c];
  else if (h < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];

  return { r: round((rp + m) * 255), g: round((gp + m) * 255), b: round((bp + m) * 255) };
}

// --- Operations ------------------------------------------------------------

/** WCAG relative luminance of a color (0 = black, 1 = white). */
export function luminance(color: RGBA): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** WCAG contrast ratio between two colors (1 to 21). */
export function contrastRatio(a: RGBA, b: RGBA): number {
  const la = luminance(a);
  const lb = luminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Mix two colors; `weight` is the amount of `b` (0 = all a, 1 = all b). */
export function mix(a: RGBA, b: RGBA, weight = 0.5): RGBA {
  const t = clamp(weight, 0, 1);
  return {
    r: round(a.r * (1 - t) + b.r * t),
    g: round(a.g * (1 - t) + b.g * t),
    b: round(a.b * (1 - t) + b.b * t),
    a: a.a * (1 - t) + b.a * t,
  };
}

/** Lighten a color by `amount` (0-1) in HSL space. */
export function lighten(color: RGBA, amount: number): RGBA {
  const hsl = rgbToHsl(color.r, color.g, color.b);
  const { r, g, b } = hslToRgb(hsl.h, hsl.s, clamp(hsl.l + amount, 0, 1));
  return { r, g, b, a: color.a };
}

/** Darken a color by `amount` (0-1) in HSL space. */
export function darken(color: RGBA, amount: number): RGBA {
  return lighten(color, -amount);
}
