// Import colour schemes written for other terminals. Gear themes carry a full
// UI palette, but the huge public scheme collections (iTerm2-Color-Schemes,
// base16, Gogh…) only describe 16 ANSI colours plus a few extras, so the UI
// colours are derived from the terminal palette.
//
// Supported: iTerm2 .itermcolors, Windows Terminal schemes (single scheme or
// a settings.json with "schemes"), VS Code colour themes (terminal.ansi*),
// Alacritty (TOML and legacy YAML), Kitty, Ghostty, Xresources, base16 YAML.

import type { TerminalPalette, Theme, ThemeColors } from "./types";
import { contrastRatio, mix, parseHex, relativeLuminance } from "./contrast";

type Ansi16 = NonNullable<TerminalPalette["ansi"]>;

export interface ForeignScheme {
  name: string;
  background: string;
  foreground: string;
  cursor?: string;
  cursorText?: string;
  selection?: string;
  ansi: string[]; // 16 entries, "#rrggbb"
}

export type ForeignFormat =
  | "iterm2"
  | "windows-terminal"
  | "vscode"
  | "alacritty"
  | "kitty"
  | "ghostty"
  | "xresources"
  | "base16";

/** "#abc", "#aabbcc", "0xaabbcc", "aabbcc", "rgb:aa/bb/cc", "#aabbccff" → "#aabbcc". */
export function normalizeColor(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/^['"]|['"]$/g, "").trim();
  const rgb = /^rgb:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})$/i.exec(s);
  if (rgb) {
    return `#${rgb
      .slice(1, 4)
      .map((c) => Math.round((parseInt(c, 16) / (16 ** c.length - 1)) * 255).toString(16).padStart(2, "0"))
      .join("")}`;
  }
  s = s.replace(/^0x/i, "").replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split("").map((c) => c + c).join("");
  if (/^[0-9a-f]{8}$/i.test(s)) s = s.slice(0, 6);
  return /^[0-9a-f]{6}$/i.test(s) ? `#${s.toLowerCase()}` : null;
}

const ANSI_NAMES = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;

function finish(partial: Partial<Omit<ForeignScheme, "ansi">> & { ansi: (string | null | undefined)[] }, name: string): ForeignScheme {
  const ansi = partial.ansi.slice(0, 16);
  for (let i = 0; i < 16; i++) {
    // Missing brights fall back to the normal colour and vice versa.
    if (!ansi[i]) ansi[i] = ansi[i < 8 ? i + 8 : i - 8] ?? null;
  }
  if (ansi.some((c) => !c)) throw new Error("The scheme does not define all 16 ANSI colours");
  const background = partial.background ?? ansi[0]!;
  const foreground = partial.foreground ?? ansi[7]!;
  return {
    name: partial.name?.trim() || name,
    background,
    foreground,
    cursor: partial.cursor ?? undefined,
    cursorText: partial.cursorText ?? undefined,
    selection: partial.selection ?? undefined,
    ansi: ansi as string[],
  };
}

// ── iTerm2 ────────────────────────────────────────────────────────────────

function parseItermColors(text: string, name: string): ForeignScheme {
  const colors = new Map<string, string>();
  const entry = /<key>([^<]+)<\/key>\s*<dict>([\s\S]*?)<\/dict>/g;
  let m: RegExpExecArray | null;
  while ((m = entry.exec(text))) {
    const comp = (c: string) => {
      const r = new RegExp(`<key>${c} Component</key>\\s*<real>([^<]+)</real>`).exec(m![2]);
      return r ? Math.max(0, Math.min(1, Number(r[1]))) : 0;
    };
    const hex = [comp("Red"), comp("Green"), comp("Blue")]
      .map((v) => Math.round(v * 255).toString(16).padStart(2, "0"))
      .join("");
    colors.set(m[1].trim(), `#${hex}`);
  }
  return finish(
    {
      background: colors.get("Background Color"),
      foreground: colors.get("Foreground Color"),
      cursor: colors.get("Cursor Color"),
      cursorText: colors.get("Cursor Text Color"),
      selection: colors.get("Selection Color"),
      ansi: Array.from({ length: 16 }, (_, i) => colors.get(`Ansi ${i} Color`)),
    },
    name,
  );
}

// ── Windows Terminal / VS Code (JSON) ─────────────────────────────────────

function fromWindowsTerminal(o: Record<string, unknown>, name: string): ForeignScheme {
  const get = (k: string) => normalizeColor(typeof o[k] === "string" ? (o[k] as string) : null);
  const names = ["black", "red", "green", "yellow", "blue", "purple", "cyan", "white"];
  return finish(
    {
      name: typeof o.name === "string" ? o.name : undefined,
      background: get("background") ?? undefined,
      foreground: get("foreground") ?? undefined,
      cursor: get("cursorColor") ?? undefined,
      selection: get("selectionBackground") ?? undefined,
      ansi: [
        ...names.map(get),
        ...names.map((n) => get(`bright${n[0].toUpperCase()}${n.slice(1)}`)),
      ],
    },
    name,
  );
}

function fromVsCode(o: Record<string, unknown>, name: string): ForeignScheme {
  const colors = (o.colors ?? {}) as Record<string, string>;
  const get = (k: string) => normalizeColor(colors[k]);
  const names = ["Black", "Red", "Green", "Yellow", "Blue", "Magenta", "Cyan", "White"];
  return finish(
    {
      name: typeof o.name === "string" ? o.name : undefined,
      background: get("terminal.background") ?? get("editor.background") ?? undefined,
      foreground: get("terminal.foreground") ?? get("editor.foreground") ?? undefined,
      cursor: get("terminalCursor.foreground") ?? get("editorCursor.foreground") ?? undefined,
      selection: get("terminal.selectionBackground") ?? get("editor.selectionBackground") ?? undefined,
      ansi: [
        ...names.map((n) => get(`terminal.ansi${n}`)),
        ...names.map((n) => get(`terminal.ansiBright${n}`)),
      ],
    },
    name,
  );
}

// ── key/value formats ─────────────────────────────────────────────────────

/** Flattens TOML sections and indented YAML into dotted keys. */
function flattenKeyValues(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let section = "";
  const stack: { indent: number; key: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const sec = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (sec) {
      section = sec[1].trim();
      stack.length = 0;
      continue;
    }
    const kv = /^(\s*)([\w.-]+)\s*[:=]\s*(.*)$/.exec(line);
    if (!kv) continue;
    const indent = kv[1].length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const path = [section, ...stack.map((s) => s.key), kv[2]].filter(Boolean).join(".");
    const value = kv[3].trim().replace(/^['"]|['"]$/g, "");
    if (value === "") stack.push({ indent, key: kv[2] });
    else out.set(path, value);
  }
  return out;
}

function parseAlacritty(text: string, name: string): ForeignScheme {
  const kv = flattenKeyValues(text);
  const get = (k: string) => normalizeColor(kv.get(k) ?? kv.get(`colors.${k}`) ?? null);
  return finish(
    {
      background: get("primary.background") ?? undefined,
      foreground: get("primary.foreground") ?? undefined,
      cursor: get("cursor.cursor") ?? undefined,
      cursorText: get("cursor.text") ?? undefined,
      selection: get("selection.background") ?? undefined,
      ansi: [...ANSI_NAMES.map((n) => get(`normal.${n}`)), ...ANSI_NAMES.map((n) => get(`bright.${n}`))],
    },
    name,
  );
}

function parseKitty(text: string, name: string): ForeignScheme {
  const kv = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([\w-]+)\s+(\S+)/.exec(line);
    if (m && !line.trim().startsWith("#")) kv.set(m[1], m[2]);
  }
  const get = (k: string) => normalizeColor(kv.get(k));
  return finish(
    {
      background: get("background") ?? undefined,
      foreground: get("foreground") ?? undefined,
      cursor: get("cursor") ?? undefined,
      cursorText: get("cursor_text_color") ?? undefined,
      selection: get("selection_background") ?? undefined,
      ansi: Array.from({ length: 16 }, (_, i) => get(`color${i}`)),
    },
    name,
  );
}

function parseGhostty(text: string, name: string): ForeignScheme {
  const kv = new Map<string, string>();
  const ansi: (string | null)[] = Array(16).fill(null);
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([\w-]+)\s*=\s*(.+?)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    if (m[1] === "palette") {
      const p = /^(\d+)\s*=\s*(\S+)$/.exec(m[2]);
      if (p && Number(p[1]) < 16) ansi[Number(p[1])] = normalizeColor(p[2]);
    } else kv.set(m[1], m[2]);
  }
  const get = (k: string) => normalizeColor(kv.get(k));
  return finish(
    {
      background: get("background") ?? undefined,
      foreground: get("foreground") ?? undefined,
      cursor: get("cursor-color") ?? undefined,
      cursorText: get("cursor-text") ?? undefined,
      selection: get("selection-background") ?? undefined,
      ansi,
    },
    name,
  );
}

function parseXresources(text: string, name: string): ForeignScheme {
  const kv = new Map<string, string>();
  const defines = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const d = /^\s*#define\s+(\S+)\s+(\S+)/.exec(line);
    if (d) defines.set(d[1], d[2]);
    const m = /^\s*[\w.*]*?[*.](\w+)\s*:\s*(\S+)/.exec(line);
    if (m && !line.trim().startsWith("!")) kv.set(m[1].toLowerCase(), defines.get(m[2]) ?? m[2]);
  }
  const get = (k: string) => normalizeColor(kv.get(k));
  return finish(
    {
      background: get("background") ?? undefined,
      foreground: get("foreground") ?? undefined,
      cursor: get("cursorcolor") ?? undefined,
      ansi: Array.from({ length: 16 }, (_, i) => get(`color${i}`)),
    },
    name,
  );
}

// base16 → ANSI, per the base16-shell mapping.
const BASE16_ANSI = ["00", "08", "0B", "0A", "0D", "0E", "0C", "05", "03", "08", "0B", "0A", "0D", "0E", "0C", "07"];

function parseBase16(text: string, name: string): ForeignScheme {
  const kv = flattenKeyValues(text);
  const base = (n: string) =>
    normalizeColor(kv.get(`base${n}`) ?? kv.get(`base${n.toLowerCase()}`) ?? kv.get(`palette.base${n}`) ?? kv.get(`palette.base${n.toLowerCase()}`));
  return finish(
    {
      name: kv.get("scheme") ?? kv.get("name"),
      background: base("00") ?? undefined,
      foreground: base("05") ?? undefined,
      cursor: base("05") ?? undefined,
      selection: base("02") ?? undefined,
      ansi: BASE16_ANSI.map(base),
    },
    name,
  );
}

// ── detection ─────────────────────────────────────────────────────────────

export function detectFormat(fileName: string, text: string): ForeignFormat | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".itermcolors") || /<key>Ansi 0 Color<\/key>/.test(text)) return "iterm2";
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    if (/"terminal\.ansi(Black|Red)"/.test(text)) return "vscode";
    if (/"brightBlack"\s*:/.test(text)) return "windows-terminal";
    return null;
  }
  if (/^\s*base0[0-9A-F]\s*:/im.test(text)) return "base16";
  if (/^\s*palette\s*=\s*\d+\s*=/m.test(text)) return "ghostty";
  if (/^\s*\[colors\.(primary|normal)\]/m.test(text) || /^\s*colors\s*:\s*$/m.test(text)) return "alacritty";
  if (/^\s*[\w.]*\*\.?color\d+\s*:/m.test(text) || /^\s*\*\.?background\s*:/m.test(text)) return "xresources";
  if (/^\s*color\d+\s+\S+/m.test(text)) return "kitty";
  return null;
}

function baseName(fileName: string): string {
  const leaf = fileName.split(/[\\/]/).pop() ?? fileName;
  const name = leaf.replace(/\.(itermcolors|json|toml|ya?ml|conf|xresources|theme|txt)$/i, "").replace(/[-_]+/g, " ").trim();
  return name || "Imported theme";
}

/** Parse every scheme in a foreign file. Throws when the format is unknown. */
export function parseForeignSchemes(fileName: string, text: string): ForeignScheme[] {
  const format = detectFormat(fileName, text);
  const name = baseName(fileName);
  switch (format) {
    case "iterm2":
      return [parseItermColors(text, name)];
    case "vscode":
      return [fromVsCode(JSON.parse(text) as Record<string, unknown>, name)];
    case "windows-terminal": {
      const json = JSON.parse(text) as Record<string, unknown>;
      const list = Array.isArray(json.schemes) ? (json.schemes as Record<string, unknown>[]) : [json];
      return list.map((s, i) => fromWindowsTerminal(s, list.length > 1 ? `${name} ${i + 1}` : name));
    }
    case "alacritty":
      return [parseAlacritty(text, name)];
    case "kitty":
      return [parseKitty(text, name)];
    case "ghostty":
      return [parseGhostty(text, name)];
    case "xresources":
      return [parseXresources(text, name)];
    case "base16":
      return [parseBase16(text, name)];
    default:
      throw new Error("Unrecognised theme format");
  }
}

// ── conversion ────────────────────────────────────────────────────────────

/** Derive Gear's UI palette from a terminal scheme. */
export function deriveUiColors(s: ForeignScheme): ThemeColors {
  const bg = s.background;
  const fg = s.foreground;
  const dark = relativeLuminance(parseHex(bg)) < 0.4;
  const blue = dark ? s.ansi[12] : s.ansi[4];
  const primary = contrastRatio(blue, bg) >= 3 ? blue : fg;
  const onPrimary = contrastRatio(bg, primary) >= contrastRatio(fg, primary) ? bg : fg;
  const surface = mix(bg, fg, dark ? 0.04 : 0.03);
  const muted = mix(bg, fg, 0.08);
  const border = mix(bg, fg, dark ? 0.14 : 0.16);
  return {
    background: bg,
    foreground: fg,
    card: surface,
    cardForeground: fg,
    popover: surface,
    popoverForeground: fg,
    primary,
    primaryForeground: onPrimary,
    secondary: muted,
    secondaryForeground: fg,
    muted,
    mutedForeground: mix(fg, bg, 0.38),
    accent: mix(bg, fg, 0.11),
    accentForeground: fg,
    destructive: dark ? s.ansi[9] : s.ansi[1],
    border,
    input: border,
    ring: primary,
    sidebar: mix(bg, fg, dark ? 0.02 : 0.025),
    sidebarForeground: fg,
    sidebarPrimary: primary,
    sidebarPrimaryForeground: onPrimary,
    sidebarAccent: mix(bg, fg, 0.1),
    sidebarAccentForeground: fg,
    sidebarBorder: border,
    sidebarRing: primary,
  };
}

export function schemeToTheme(s: ForeignScheme, id = `imported-${Date.now()}`): Theme {
  const variant = {
    colors: deriveUiColors(s),
    terminal: {
      background: s.background,
      foreground: s.foreground,
      cursor: s.cursor ?? s.foreground,
      cursorAccent: s.cursorText ?? s.background,
      // A translucent selection keeps text readable under it.
      selection: `${s.selection ?? mix(s.background, s.foreground, 0.25)}${s.selection ? "88" : ""}`,
      ansi: s.ansi as unknown as Ansi16,
    } satisfies TerminalPalette,
  };
  const dark = relativeLuminance(parseHex(s.background)) < 0.4;
  return {
    id,
    name: s.name,
    description: `Imported ${dark ? "dark" : "light"} terminal scheme`,
    // A terminal scheme is a single look; use it whichever mode is active.
    variants: { light: variant, dark: variant },
  };
}

export function importForeignThemes(fileName: string, text: string): Theme[] {
  const stamp = Date.now();
  return parseForeignSchemes(fileName, text).map((s, i) => schemeToTheme(s, `imported-${stamp}-${i}`));
}
