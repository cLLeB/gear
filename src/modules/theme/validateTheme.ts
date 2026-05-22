import type { Theme, ThemeColors, ThemeVariant, TerminalPalette } from "./types";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateColors(v: unknown): ThemeColors | undefined {
  if (!isObject(v)) return undefined;
  const result: ThemeColors = {};
  const fields = [
    "background", "foreground", "card", "cardForeground", "popover", "popoverForeground",
    "primary", "primaryForeground", "secondary", "secondaryForeground",
    "muted", "mutedForeground", "accent", "accentForeground", "destructive",
    "border", "input", "ring", "sidebar", "sidebarForeground", "sidebarPrimary",
    "sidebarPrimaryForeground", "sidebarAccent", "sidebarAccentForeground",
    "sidebarBorder", "sidebarRing", "radius",
  ] as const;
  for (const f of fields) {
    if (typeof v[f] === "string") (result as Record<string, string>)[f] = v[f] as string;
  }
  return result;
}

function validateTerminalPalette(v: unknown): TerminalPalette | undefined {
  if (!isObject(v)) return undefined;
  const result: TerminalPalette = {};
  const strFields = ["background", "foreground", "cursor", "cursorAccent", "selection"] as const;
  for (const f of strFields) {
    if (typeof v[f] === "string") result[f] = v[f] as string;
  }
  if (
    Array.isArray(v.ansi) &&
    v.ansi.length === 16 &&
    v.ansi.every((c: unknown) => typeof c === "string")
  ) {
    result.ansi = v.ansi as unknown as TerminalPalette["ansi"];
  }
  return result;
}

function validateVariant(v: unknown): ThemeVariant {
  if (!isObject(v)) return {};
  const result: ThemeVariant = {};
  const colors = validateColors(v.colors);
  if (colors) result.colors = colors;
  const terminal = validateTerminalPalette(v.terminal);
  if (terminal) result.terminal = terminal;
  return result;
}

export function validateTheme(raw: unknown): Theme {
  if (!isObject(raw)) throw new Error("Theme must be a JSON object");
  if (typeof raw.id !== "string" || !raw.id) throw new Error("Theme must have an id string");
  if (typeof raw.name !== "string" || !raw.name) throw new Error("Theme must have a name string");
  if (!isObject(raw.variants)) throw new Error("Theme must have a variants object");

  const theme: Theme = {
    id: raw.id,
    name: raw.name,
    variants: {},
  };

  if (typeof raw.author === "string") theme.author = raw.author;
  if (typeof raw.description === "string") theme.description = raw.description;

  if (isObject(raw.variants.light)) theme.variants.light = validateVariant(raw.variants.light);
  if (isObject(raw.variants.dark)) theme.variants.dark = validateVariant(raw.variants.dark);

  if (isObject(raw.editorTheme)) {
    theme.editorTheme = {};
    if (typeof raw.editorTheme.light === "string") theme.editorTheme.light = raw.editorTheme.light;
    if (typeof raw.editorTheme.dark === "string") theme.editorTheme.dark = raw.editorTheme.dark;
  }

  return theme;
}
