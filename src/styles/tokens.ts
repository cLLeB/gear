/**
 * Runtime resolution of CSS custom properties into concrete rgb strings.
 *
 * globals.css declares tokens in oklch(), which xterm.js (WebGL) and
 * CodeMirror's static theme builder can't consume directly. We resolve each
 * token through the browser: setting `color: var(--x)` on a detached element
 * forces computation into rgb form, which both consumers accept.
 *
 * Tokens are read once per call. Callers that need to react to theme changes
 * should re-invoke and rebuild their theme object.
 */

let probe: HTMLDivElement | null = null;

function resolve(varName: string): string {
  if (!probe) {
    probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";
    document.body.appendChild(probe);
  }
  probe.style.color = `var(--${varName})`;
  return getComputedStyle(probe).color;
}

type TerminalTokenName =
  | "background"
  | "foreground"
  | "cursor"
  | "cursor-accent"
  | "selection"
  | "ansi-black"
  | "ansi-red"
  | "ansi-green"
  | "ansi-yellow"
  | "ansi-blue"
  | "ansi-magenta"
  | "ansi-cyan"
  | "ansi-white"
  | "ansi-bright-black"
  | "ansi-bright-red"
  | "ansi-bright-green"
  | "ansi-bright-yellow"
  | "ansi-bright-blue"
  | "ansi-bright-magenta"
  | "ansi-bright-cyan"
  | "ansi-bright-white";

export type TerminalTokens = Record<TerminalTokenName, string>;

const TERMINAL_TOKEN_NAMES: TerminalTokenName[] = [
  "background", "foreground", "cursor", "cursor-accent", "selection",
  "ansi-black", "ansi-red", "ansi-green", "ansi-yellow",
  "ansi-blue", "ansi-magenta", "ansi-cyan", "ansi-white",
  "ansi-bright-black", "ansi-bright-red", "ansi-bright-green", "ansi-bright-yellow",
  "ansi-bright-blue", "ansi-bright-magenta", "ansi-bright-cyan", "ansi-bright-white",
];

export function readTerminalTokens(): TerminalTokens {
  const out = {} as TerminalTokens;
  for (const name of TERMINAL_TOKEN_NAMES) {
    out[name] = resolve(`terminal-${name}`);
  }
  return out;
}

type AppTokenName =
  | "background"
  | "foreground"
  | "card"
  | "muted"
  | "muted-foreground"
  | "accent"
  | "accent-foreground"
  | "border"
  | "primary"
  | "destructive"
  | "ring";

export type AppTokens = Record<AppTokenName, string>;

const APP_TOKEN_NAMES: AppTokenName[] = [
  "background",
  "foreground",
  "card",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "border",
  "primary",
  "destructive",
  "ring",
];

export function readAppTokens(): AppTokens {
  const out = {} as AppTokens;
  for (const name of APP_TOKEN_NAMES) out[name] = resolve(name);
  return out;
}
