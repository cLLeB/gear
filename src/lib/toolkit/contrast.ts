import { hexToRgb, type RGB } from "./color";

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an RGB color, in [0, 1]. */
export function relativeLuminance({ r, g, b }: RGB): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colors (hex strings), from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return 1;
  const la = relativeLuminance(ca);
  const lb = relativeLuminance(cb);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Pick black or white text for best contrast on the given background hex. */
export function readableTextColor(background: string): "#000000" | "#ffffff" {
  return contrastRatio(background, "#000000") >= contrastRatio(background, "#ffffff")
    ? "#000000"
    : "#ffffff";
}

/** True when contrast meets WCAG AA (4.5 normal / 3.0 large text). */
export function meetsWcagAA(a: string, b: string, largeText = false): boolean {
  return contrastRatio(a, b) >= (largeText ? 3 : 4.5);
}
