// WCAG 2.x contrast math plus a theme audit: which text/background pairs in a
// theme fall below the readable minimum.

import type { Theme, ThemeVariant } from "./types";

export type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb {
  let s = hex.trim().replace(/^#/, "");
  if (s.length === 3 || s.length === 4) s = s.slice(0, 3).split("").map((c) => c + c).join("");
  const n = parseInt(s.slice(0, 6), 16);
  if (!/^[0-9a-f]{6}/i.test(s) || Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}

/** Linear blend: t=0 → a, t=1 → b. */
export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as Rgb);
}

export function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(parseHex(a));
  const lb = relativeLuminance(parseHex(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Only plain hex colours can be checked; CSS functions/vars are skipped. */
function isHex(v: string | undefined): v is string {
  return !!v && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v.trim());
}

export interface ContrastIssue {
  pair: string;
  fg: string;
  bg: string;
  ratio: number;
  minimum: number;
}

const ANSI_NAMES = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "bright black", "bright red", "bright green", "bright yellow",
  "bright blue", "bright magenta", "bright cyan", "bright white",
];

/**
 * Pairs below WCAG AA (4.5 for body text, 3 for large/secondary text).
 * Terminal ANSI colours are checked at 3:1 — they colour short tokens — and
 * the one meant to blend in (black on dark, white on light) is skipped.
 */
export function auditVariant(v: ThemeVariant): ContrastIssue[] {
  const issues: ContrastIssue[] = [];
  const check = (pair: string, fg: string | undefined, bg: string | undefined, minimum: number) => {
    if (!isHex(fg) || !isHex(bg)) return;
    const ratio = contrastRatio(fg, bg);
    if (ratio < minimum) issues.push({ pair, fg, bg, ratio, minimum });
  };
  const c = v.colors ?? {};
  check("Text on background", c.foreground, c.background, 4.5);
  check("Card text", c.cardForeground, c.card, 4.5);
  check("Popover text", c.popoverForeground, c.popover, 4.5);
  check("Muted text", c.mutedForeground, c.background, 3);
  check("Primary button text", c.primaryForeground, c.primary, 4.5);
  check("Sidebar text", c.sidebarForeground, c.sidebar, 4.5);
  check("Accent text", c.accentForeground, c.accent, 4.5);
  const t = v.terminal ?? {};
  check("Terminal text", t.foreground, t.background, 4.5);
  if (t.ansi && isHex(t.background)) {
    const dark = relativeLuminance(parseHex(t.background)) < 0.4;
    t.ansi.forEach((color, i) => {
      if (dark && (i === 0 || i === 8)) return;
      if (!dark && (i === 7 || i === 15)) return;
      check(`Terminal ${ANSI_NAMES[i]}`, color, t.background, 3);
    });
  }
  return issues;
}

export function auditTheme(theme: Theme): { mode: "light" | "dark"; issues: ContrastIssue[] }[] {
  const out: { mode: "light" | "dark"; issues: ContrastIssue[] }[] = [];
  for (const mode of ["dark", "light"] as const) {
    const v = theme.variants[mode];
    if (v) out.push({ mode, issues: auditVariant(v) });
  }
  return out;
}
