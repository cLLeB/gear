// Find CSS colour literals in text and convert between notations. Handles
// legacy comma syntax and modern space syntax (`rgb(255 0 0 / 50%)`).

import { parseColor, rgbToHsl, toHex, type RGBA } from "@/lib/lang/color";

export type ColorFormat = "hex" | "rgb" | "hsl";

export interface FoundColor {
  from: number;
  to: number;
  text: string;
  color: RGBA;
  format: ColorFormat;
}

const COLOR_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?)\([^()\n]{5,60}\)/g;

/** Parse one literal, accepting modern space-separated syntax too. */
export function parseCssColor(text: string): RGBA | null {
  const m = /^(rgba?|hsla?)\(([^)]*)\)$/i.exec(text.trim());
  if (!m) return parseColor(text);
  // Split into components, accepting "a, b, c[, d]" and "a b c [/ d]".
  const raw = m[2].trim();
  const [main, slashAlpha] = raw.includes(",") ? [raw, undefined] : raw.split("/").map((p) => p.trim());
  const parts = main.includes(",") ? main.split(",").map((p) => p.trim()) : main.split(/\s+/);
  if (slashAlpha !== undefined) parts.push(slashAlpha);
  if (parts.length === 4 && parts[3].endsWith("%")) parts[3] = String(Number(parts[3].slice(0, -1)) / 100);
  parts[0] = parts[0].replace(/deg$/, ""); // hsl hue may carry "deg"
  let body = parts.join(", ");
  const fn = m[1].toLowerCase().startsWith("hsl") ? "hsl" : "rgb";
  // rgb percentages "100% 0% 0%"
  if (fn === "rgb") {
    body = parts
      .map((p, i) => (i < 3 && p.endsWith("%") ? String(Math.round((Number(p.slice(0, -1)) / 100) * 255)) : p))
      .join(", ");
  }
  return parseColor(`${fn}a(${body})`) ?? parseColor(`${fn}(${body})`);
}

export function findColors(text: string, offset = 0): FoundColor[] {
  const out: FoundColor[] = [];
  for (const m of text.matchAll(COLOR_RE)) {
    const color = parseCssColor(m[0]);
    if (!color) continue;
    // Skip hex that is really part of an identifier/hash like "#123abc_def" or a URL fragment.
    const before = text[m.index! - 1];
    if (m[0].startsWith("#") && before && /[\w&/]/.test(before)) continue;
    out.push({
      from: offset + m.index!,
      to: offset + m.index! + m[0].length,
      text: m[0],
      color,
      format: m[0].startsWith("#") ? "hex" : m[0].toLowerCase().startsWith("hsl") ? "hsl" : "rgb",
    });
  }
  return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function formatColor(c: RGBA, format: ColorFormat): string {
  if (format === "hex") return toHex(c);
  if (format === "rgb") {
    return c.a < 1 ? `rgba(${c.r}, ${c.g}, ${c.b}, ${r2(c.a)})` : `rgb(${c.r}, ${c.g}, ${c.b})`;
  }
  const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
  const hs = `${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%`;
  return c.a < 1 ? `hsla(${hs}, ${r2(c.a)})` : `hsl(${hs})`;
}

export function nextFormat(f: ColorFormat): ColorFormat {
  return f === "hex" ? "rgb" : f === "rgb" ? "hsl" : "hex";
}
