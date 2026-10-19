// Colors for UI work: reads every CSS color notation (hex, rgb, hsl, hwb,
// oklch, oklab, names), converts between them, checks contrast (WCAG 2 and
// APCA), builds 50–950 scales in OKLCH, simulates colour blindness, and
// finds the colours a codebase uses, with near-duplicates grouped.

export interface Rgb {
  /** 0–1 sRGB, may fall outside the gamut while converting. */
  r: number;
  g: number;
  b: number;
  /** 0–1 */
  alpha: number;
}

export interface Oklch {
  l: number;
  c: number;
  /** Degrees, 0–360. */
  h: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** CSS named colors. */
export const NAMED: Record<string, string> = {
  aliceblue: "f0f8ff", antiquewhite: "faebd7", aqua: "00ffff", aquamarine: "7fffd4", azure: "f0ffff", beige: "f5f5dc", bisque: "ffe4c4", black: "000000", blanchedalmond: "ffebcd", blue: "0000ff", blueviolet: "8a2be2", brown: "a52a2a", burlywood: "deb887", cadetblue: "5f9ea0", chartreuse: "7fff00", chocolate: "d2691e", coral: "ff7f50", cornflowerblue: "6495ed", cornsilk: "fff8dc", crimson: "dc143c", cyan: "00ffff", darkblue: "00008b", darkcyan: "008b8b", darkgoldenrod: "b8860b", darkgray: "a9a9a9", darkgreen: "006400", darkgrey: "a9a9a9", darkkhaki: "bdb76b", darkmagenta: "8b008b", darkolivegreen: "556b2f", darkorange: "ff8c00", darkorchid: "9932cc", darkred: "8b0000", darksalmon: "e9967a", darkseagreen: "8fbc8f", darkslateblue: "483d8b", darkslategray: "2f4f4f", darkslategrey: "2f4f4f", darkturquoise: "00ced1", darkviolet: "9400d3", deeppink: "ff1493", deepskyblue: "00bfff", dimgray: "696969", dimgrey: "696969", dodgerblue: "1e90ff", firebrick: "b22222", floralwhite: "fffaf0", forestgreen: "228b22", fuchsia: "ff00ff", gainsboro: "dcdcdc", ghostwhite: "f8f8ff", gold: "ffd700", goldenrod: "daa520", gray: "808080", green: "008000", greenyellow: "adff2f", grey: "808080", honeydew: "f0fff0", hotpink: "ff69b4", indianred: "cd5c5c", indigo: "4b0082", ivory: "fffff0", khaki: "f0e68c", lavender: "e6e6fa", lavenderblush: "fff0f5", lawngreen: "7cfc00", lemonchiffon: "fffacd", lightblue: "add8e6", lightcoral: "f08080", lightcyan: "e0ffff", lightgoldenrodyellow: "fafad2", lightgray: "d3d3d3", lightgreen: "90ee90", lightgrey: "d3d3d3", lightpink: "ffb6c1", lightsalmon: "ffa07a", lightseagreen: "20b2aa", lightskyblue: "87cefa", lightslategray: "778899", lightslategrey: "778899", lightsteelblue: "b0c4de", lightyellow: "ffffe0", lime: "00ff00", limegreen: "32cd32", linen: "faf0e6", magenta: "ff00ff", maroon: "800000", mediumaquamarine: "66cdaa", mediumblue: "0000cd", mediumorchid: "ba55d3", mediumpurple: "9370db", mediumseagreen: "3cb371", mediumslateblue: "7b68ee", mediumspringgreen: "00fa9a", mediumturquoise: "48d1cc", mediumvioletred: "c71585", midnightblue: "191970", mintcream: "f5fffa", mistyrose: "ffe4e1", moccasin: "ffe4b5", navajowhite: "ffdead", navy: "000080", oldlace: "fdf5e6", olive: "808000", olivedrab: "6b8e23", orange: "ffa500", orangered: "ff4500", orchid: "da70d6", palegoldenrod: "eee8aa", palegreen: "98fb98", paleturquoise: "afeeee", palevioletred: "db7093", papayawhip: "ffefd5", peachpuff: "ffdab9", peru: "cd853f", pink: "ffc0cb", plum: "dda0dd", powderblue: "b0e0e6", purple: "800080", rebeccapurple: "663399", red: "ff0000", rosybrown: "bc8f8f", royalblue: "4169e1", saddlebrown: "8b4513", salmon: "fa8072", sandybrown: "f4a460", seagreen: "2e8b57", seashell: "fff5ee", sienna: "a0522d", silver: "c0c0c0", skyblue: "87ceeb", slateblue: "6a5acd", slategray: "708090", slategrey: "708090", snow: "fffafa", springgreen: "00ff7f", steelblue: "4682b4", tan: "d2b48c", teal: "008080", thistle: "d8bfd8", tomato: "ff6347", turquoise: "40e0d0", violet: "ee82ee", wheat: "f5deb3", white: "ffffff", whitesmoke: "f5f5f5", yellow: "ffff00", yellowgreen: "9acd32",
};

// --- Conversions -----------------------------------------------------------

const toLinear = (c: number) => (Math.abs(c) <= 0.04045 ? c / 12.92 : Math.sign(c) * ((Math.abs(c) + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (Math.abs(c) <= 0.0031308 ? c * 12.92 : Math.sign(c) * (1.055 * Math.abs(c) ** (1 / 2.4) - 0.055));

export function rgbToOklab({ r, g, b }: Rgb): { l: number; a: number; b: number } {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return { l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s };
}

export function oklabToRgb(L: number, A: number, B: number, alpha = 1): Rgb {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    alpha,
  };
}

export function rgbToOklch(c: Rgb): Oklch {
  const { l, a, b } = rgbToOklab(c);
  const chroma = Math.hypot(a, b);
  const h = chroma < 1e-4 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { l, c: chroma, h };
}

export function oklchToRgb({ l, c, h }: Oklch, alpha = 1): Rgb {
  const rad = (h * Math.PI) / 180;
  return oklabToRgb(l, c * Math.cos(rad), c * Math.sin(rad), alpha);
}

export const inGamut = (c: Rgb, eps = 1e-4) => [c.r, c.g, c.b].every((v) => v >= -eps && v <= 1 + eps);

/** Brings an OKLCH colour into sRGB by lowering its chroma, keeping lightness and hue. */
export function gamutMap(o: Oklch, alpha = 1): Rgb {
  let rgb = oklchToRgb(o, alpha);
  if (inGamut(rgb)) return clampRgb(rgb);
  let lo = 0;
  let hi = o.c;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToRgb({ ...o, c: mid }))) lo = mid;
    else hi = mid;
  }
  rgb = oklchToRgb({ ...o, c: lo }, alpha);
  return clampRgb(rgb);
}

const clampRgb = (c: Rgb): Rgb => ({ r: clamp01(c.r), g: clamp01(c.g), b: clamp01(c.b), alpha: clamp01(c.alpha) });

export function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return { h, s, l };
}

export function hslToRgb(h: number, s: number, l: number, alpha = 1): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: f(0), g: f(8), b: f(4), alpha };
}

export function hwbToRgb(h: number, w: number, bl: number, alpha = 1): Rgb {
  if (w + bl >= 1) {
    const gray = w / (w + bl);
    return { r: gray, g: gray, b: gray, alpha };
  }
  const base = hslToRgb(h, 1, 0.5);
  const f = (v: number) => v * (1 - w - bl) + w;
  return { r: f(base.r), g: f(base.g), b: f(base.b), alpha };
}

// --- Parsing ---------------------------------------------------------------

function num(token: string, percentOf: number): number | null {
  const t = token.trim().toLowerCase();
  if (t === "none") return 0;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|rad|grad|turn)?$/.exec(t);
  if (!m) return null;
  const v = Number(m[1]);
  switch (m[2]) {
    case "%":
      return (v / 100) * percentOf;
    case "rad":
      return (v * 180) / Math.PI;
    case "grad":
      return v * 0.9;
    case "turn":
      return v * 360;
    default:
      return v;
  }
}

/** Splits `a b c / d` or `a, b, c, d` into the channel and alpha tokens. */
function channels(body: string): { parts: string[]; alpha: string | null } | null {
  const slash = body.split("/");
  if (slash.length > 2) return null;
  const main = slash[0].includes(",") ? slash[0].split(",") : slash[0].trim().split(/\s+/);
  const parts = main.map((p) => p.trim()).filter(Boolean);
  let alpha: string | null = slash[1]?.trim() ?? null;
  if (alpha === null && parts.length === 4) alpha = parts.pop() ?? null;
  return parts.length === 3 ? { parts, alpha } : null;
}

/** Reads any CSS colour. Returns null for what is not one. */
export function parseColor(input: string): Rgb | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (s === "transparent") return { r: 0, g: 0, b: 0, alpha: 0 };
  const named = NAMED[s];
  if (named) return parseColor(`#${named}`);
  const hex = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex && (s.startsWith("#") || /[a-f]/.test(hex[1]) || hex[1].length >= 6)) {
    let h = hex[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    const v = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    return { r: v(0), g: v(2), b: v(4), alpha: h.length === 8 ? v(6) : 1 };
  }
  const fn = /^([a-z]+)\((.*)\)$/.exec(s);
  if (!fn) return null;
  const ch = channels(fn[2]);
  if (!ch) return null;
  const alpha = ch.alpha === null ? 1 : num(ch.alpha, 1);
  if (alpha === null) return null;
  const [p0, p1, p2] = ch.parts;
  let out: Rgb | null = null;
  switch (fn[1]) {
    case "rgb":
    case "rgba": {
      const v = [p0, p1, p2].map((p) => num(p, 255));
      if (v.some((x) => x === null)) return null;
      out = { r: (v[0] as number) / 255, g: (v[1] as number) / 255, b: (v[2] as number) / 255, alpha };
      break;
    }
    case "hsl":
    case "hsla": {
      const h = num(p0, 360);
      const sat = num(p1.endsWith("%") ? p1 : `${p1}%`, 1);
      const l = num(p2.endsWith("%") ? p2 : `${p2}%`, 1);
      if (h === null || sat === null || l === null) return null;
      out = hslToRgb(((h % 360) + 360) % 360, clamp01(sat), clamp01(l), alpha);
      break;
    }
    case "hwb": {
      const h = num(p0, 360);
      const w = num(p1.endsWith("%") ? p1 : `${p1}%`, 1);
      const b = num(p2.endsWith("%") ? p2 : `${p2}%`, 1);
      if (h === null || w === null || b === null) return null;
      out = hwbToRgb(((h % 360) + 360) % 360, clamp01(w), clamp01(b), alpha);
      break;
    }
    case "oklch": {
      const l = num(p0, 1);
      const c = num(p1, 0.4);
      const h = num(p2, 360);
      if (l === null || c === null || h === null) return null;
      out = gamutMap({ l: clamp01(l), c: Math.max(0, c), h: ((h % 360) + 360) % 360 }, alpha);
      break;
    }
    case "oklab": {
      const l = num(p0, 1);
      const a = num(p1, 0.4);
      const b = num(p2, 0.4);
      if (l === null || a === null || b === null) return null;
      out = gamutMap({ l: clamp01(l), c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 }, alpha);
      break;
    }
    default:
      return null;
  }
  return clampRgb(out);
}

// --- Formatting ------------------------------------------------------------

const r255 = (v: number) => Math.round(clamp01(v) * 255);
const trim = (v: number, digits: number) => String(Number(v.toFixed(digits)));
const alphaPart = (a: number, sep: string) => (a < 1 ? `${sep}${trim(a, 3)}` : "");

export function toHex(c: Rgb): string {
  const h = (v: number) => r255(v).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${c.alpha < 1 ? h(c.alpha) : ""}`;
}

export type Format = "hex" | "rgb" | "hsl" | "hwb" | "oklch" | "oklab";
export const FORMATS: Format[] = ["hex", "rgb", "hsl", "hwb", "oklch", "oklab"];

export function format(c: Rgb, f: Format): string {
  switch (f) {
    case "hex":
      return toHex(c);
    case "rgb":
      return `rgb(${r255(c.r)} ${r255(c.g)} ${r255(c.b)}${alphaPart(c.alpha, " / ")})`;
    case "hsl": {
      const { h, s, l } = rgbToHsl(c);
      return `hsl(${trim(h, 1)} ${trim(s * 100, 1)}% ${trim(l * 100, 1)}%${alphaPart(c.alpha, " / ")})`;
    }
    case "hwb": {
      const { h } = rgbToHsl(c);
      const w = Math.min(c.r, c.g, c.b);
      const bl = 1 - Math.max(c.r, c.g, c.b);
      return `hwb(${trim(h, 1)} ${trim(w * 100, 1)}% ${trim(bl * 100, 1)}%${alphaPart(c.alpha, " / ")})`;
    }
    case "oklch": {
      const o = rgbToOklch(c);
      return `oklch(${trim(o.l * 100, 2)}% ${trim(o.c, 4)} ${trim(o.h, 2)}${alphaPart(c.alpha, " / ")})`;
    }
    case "oklab": {
      const o = rgbToOklab(c);
      return `oklab(${trim(o.l * 100, 2)}% ${trim(o.a, 4)} ${trim(o.b, 4)}${alphaPart(c.alpha, " / ")})`;
    }
  }
}

/** The CSS name of a colour, when it has one exactly. */
export function nameOf(c: Rgb): string | null {
  if (c.alpha < 1) return c.alpha === 0 ? "transparent" : null;
  const hex = toHex(c).slice(1);
  return Object.keys(NAMED).find((n) => NAMED[n] === hex) ?? null;
}

// --- Contrast --------------------------------------------------------------

/** Paints a translucent colour over a background. */
export function composite(fg: Rgb, bg: Rgb): Rgb {
  const a = fg.alpha;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), alpha: 1 };
}

export function luminance(c: Rgb): number {
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

/** WCAG 2 contrast ratio, 1–21. */
export function wcagRatio(fg: Rgb, bg: Rgb): number {
  const f = luminance(composite(fg, bg));
  const b = luminance(bg);
  return (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05);
}

export function wcagGrades(ratio: number): { aaNormal: boolean; aaLarge: boolean; aaaNormal: boolean; aaaLarge: boolean; ui: boolean } {
  return { aaNormal: ratio >= 4.5, aaLarge: ratio >= 3, aaaNormal: ratio >= 7, aaaLarge: ratio >= 4.5, ui: ratio >= 3 };
}

/** APCA lightness contrast (Lc), roughly −108…106; the sign tells dark-on-light from light-on-dark. */
export function apca(fg: Rgb, bg: Rgb): number {
  const y = (c: Rgb) => {
    const lin = (v: number) => clamp01(v) ** 2.4;
    const v = 0.2126729 * lin(c.r) + 0.7151522 * lin(c.g) + 0.072175 * lin(c.b);
    return v < 0.022 ? v + (0.022 - v) ** 1.414 : v;
  };
  const txt = y(composite(fg, bg));
  const bgY = y(bg);
  if (Math.abs(bgY - txt) < 0.0005) return 0;
  if (bgY > txt) {
    const s = (bgY ** 0.56 - txt ** 0.57) * 1.14;
    return s < 0.1 ? 0 : (s - 0.027) * 100;
  }
  const s = (bgY ** 0.65 - txt ** 0.62) * 1.14;
  return s > -0.1 ? 0 : (s + 0.027) * 100;
}

/** What APCA Lc allows, in words (from the APCA readability guidance). */
export function apcaUse(lc: number): string {
  const v = Math.abs(lc);
  if (v >= 90) return "Any text, including thin and small body text";
  if (v >= 75) return "Body text (18px regular / 14px bold and up)";
  if (v >= 60) return "Content text (24px regular / 16px bold and up)";
  if (v >= 45) return "Headlines (36px regular / 24px bold) and large icons";
  if (v >= 30) return "Large non-text elements, placeholder or disabled text";
  if (v >= 15) return "Only dividers and other non-essential decoration";
  return "Not readable";
}

/** The closest colour with the same hue that reaches a WCAG ratio against bg, by changing lightness. */
export function fixContrast(fg: Rgb, bg: Rgb, target: number): Rgb | null {
  const o = rgbToOklch(fg);
  const bgLighter = luminance(bg) > 0.18;
  let best: Rgb | null = null;
  // Walk away from the background's lightness in small steps.
  for (let i = 0; i <= 100; i++) {
    const l = bgLighter ? o.l - (o.l * i) / 100 : o.l + ((1 - o.l) * i) / 100;
    const cand = gamutMap({ l, c: o.c, h: o.h }, 1);
    if (wcagRatio(cand, bg) >= target) {
      best = cand;
      break;
    }
  }
  return best;
}

// --- Scales and harmonies --------------------------------------------------

export const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
/** OKLCH lightness of each step, close to what common design systems use. */
const STEP_L = [0.97, 0.936, 0.885, 0.808, 0.711, 0.637, 0.555, 0.479, 0.406, 0.348, 0.252];

/**
 * A 50–950 scale around a colour. The step closest in lightness to the
 * colour is the colour itself; chroma eases off towards both ends.
 */
export function scale(base: Rgb): { step: (typeof STEPS)[number]; color: Rgb; isBase: boolean }[] {
  const o = rgbToOklch(base);
  let anchor = 0;
  STEP_L.forEach((l, i) => {
    if (Math.abs(l - o.l) < Math.abs(STEP_L[anchor] - o.l)) anchor = i;
  });
  const shift = o.l - STEP_L[anchor];
  return STEPS.map((step, i) => {
    if (i === anchor) return { step, color: { ...base, alpha: 1 }, isBase: true };
    const t = Math.abs(i - anchor) / Math.max(anchor, STEPS.length - 1 - anchor);
    const l = clamp01(STEP_L[i] + shift * (1 - t));
    const c = o.c * (1 - 0.65 * t ** 1.5) * (i < anchor ? 1 - 0.3 * t : 1);
    return { step, color: gamutMap({ l, c, h: o.h }), isBase: false };
  });
}

export type Harmony = "complementary" | "analogous" | "triadic" | "split" | "tetradic";

export function harmony(base: Rgb, kind: Harmony): Rgb[] {
  const o = rgbToOklch(base);
  const offsets: Record<Harmony, number[]> = { complementary: [0, 180], analogous: [-30, 0, 30], triadic: [0, 120, 240], split: [0, 150, 210], tetradic: [0, 90, 180, 270] };
  return offsets[kind].map((d) => (d === 0 ? { ...base, alpha: 1 } : gamutMap({ ...o, h: (o.h + d + 360) % 360 })));
}

// --- Colour vision ---------------------------------------------------------

export type Vision = "normal" | "protanopia" | "deuteranopia" | "tritanopia" | "achromatopsia";

/** Machado et al. (2009) matrices at full severity, applied in linear RGB. */
const VISION: Record<Exclude<Vision, "normal" | "achromatopsia">, number[]> = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

export function simulate(c: Rgb, v: Vision): Rgb {
  if (v === "normal") return c;
  const r = toLinear(c.r);
  const g = toLinear(c.g);
  const b = toLinear(c.b);
  if (v === "achromatopsia") {
    const y = fromLinear(0.2126 * r + 0.7152 * g + 0.0722 * b);
    return { r: y, g: y, b: y, alpha: c.alpha };
  }
  const m = VISION[v];
  return clampRgb({ r: fromLinear(m[0] * r + m[1] * g + m[2] * b), g: fromLinear(m[3] * r + m[4] * g + m[5] * b), b: fromLinear(m[6] * r + m[7] * g + m[8] * b), alpha: c.alpha });
}

/** Perceptual distance (ΔE in OKLab, ×100); under ~2 is hard to tell apart. */
export function deltaE(a: Rgb, b: Rgb): number {
  const x = rgbToOklab(a);
  const y = rgbToOklab(b);
  return Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b) * 100;
}

// --- Export ----------------------------------------------------------------

export type ExportStyle = "css" | "tailwind" | "scss" | "json";

export function exportScale(name: string, steps: { step: number; color: Rgb }[], style: ExportStyle, fmt: Format = "hex"): string {
  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brand";
  const v = (c: Rgb) => format(c, fmt);
  switch (style) {
    case "css":
      return `:root {\n${steps.map((s) => `  --${id}-${s.step}: ${v(s.color)};`).join("\n")}\n}`;
    case "tailwind":
      return `@theme {\n${steps.map((s) => `  --color-${id}-${s.step}: ${v(s.color)};`).join("\n")}\n}`;
    case "scss":
      return steps.map((s) => `$${id}-${s.step}: ${v(s.color)};`).join("\n");
    case "json":
      return JSON.stringify({ [id]: Object.fromEntries(steps.map((s) => [String(s.step), v(s.color)])) }, null, 2);
  }
}

// --- Finding colours in code -----------------------------------------------

const COLOR_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?|hwb|oklch|oklab)\([^()]*\)/g;

export interface Found {
  /** As written. */
  text: string;
  color: Rgb;
  line: number;
  column: number;
}

/**
 * The colours written in a file. Hex is only taken where it cannot be
 * something else: not in URLs (#anchor), not as a hash or ID in code.
 */
export function findColors(text: string): Found[] {
  const out: Found[] = [];
  const lines = text.split("\n");
  lines.forEach((lineText, i) => {
    for (const m of lineText.matchAll(COLOR_RE)) {
      const before = lineText.slice(Math.max(0, (m.index ?? 0) - 1), m.index);
      // `&#123;`, `/page#fff`, `id#abc`, `issue #123` with digits only are not colours.
      if (m[0].startsWith("#") && (/[\w&/]/.test(before) || /^#\d{3,4}$/.test(m[0]))) continue;
      const color = parseColor(m[0]);
      if (color) out.push({ text: m[0], color, line: i + 1, column: (m.index ?? 0) + 1 });
    }
  });
  return out;
}

export interface UsedColor {
  hex: string;
  color: Rgb;
  count: number;
  spellings: string[];
  places: { file: string; line: number; column: number }[];
}

/** Colours across files, counted, most used first, with near-identical ones grouped. */
export function collectColors(files: { path: string; text: string }[], groupBelow = 2): { colors: UsedColor[]; groups: UsedColor[][] } {
  const byHex = new Map<string, UsedColor>();
  for (const f of files) {
    for (const found of findColors(f.text)) {
      const hex = toHex(found.color);
      const u = byHex.get(hex) ?? { hex, color: found.color, count: 0, spellings: [], places: [] };
      u.count++;
      if (!u.spellings.includes(found.text)) u.spellings.push(found.text);
      if (u.places.length < 200) u.places.push({ file: f.path, line: found.line, column: found.column });
      byHex.set(hex, u);
    }
  }
  const colors = [...byHex.values()].sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex));
  // Single-link grouping of colours closer than `groupBelow`.
  const seen = new Set<string>();
  const groups: UsedColor[][] = [];
  for (const c of colors) {
    if (seen.has(c.hex)) continue;
    const group = [c];
    seen.add(c.hex);
    for (let i = 0; i < group.length; i++) {
      for (const other of colors) {
        if (!seen.has(other.hex) && other.color.alpha === group[i].color.alpha && deltaE(group[i].color, other.color) < groupBelow) {
          seen.add(other.hex);
          group.push(other);
        }
      }
    }
    if (group.length > 1) groups.push(group);
  }
  return { colors, groups };
}
