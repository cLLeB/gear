// An ANSI/SGR parser for terminal output. Gear is a terminal, so rendering
// program output means interpreting the escape sequences that carry color and
// text attributes: `\x1b[1;31m` (bold red), 256-color `\x1b[38;5;208m`, and
// 24-bit truecolor `\x1b[38;2;255;128;0m`. This splits a raw stream into styled
// segments an editor/terminal view can render, tracking the current attributes
// across sequences, and also exposes `stripAnsi` for when the plain text is all
// that's wanted (search, logging, width calculations).

export type Color = number | { r: number; g: number; b: number };

export interface Style {
  fg?: Color;
  bg?: Color;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strikethrough?: boolean;
}

export interface Segment {
  text: string;
  style: Style;
}

// Matches CSI sequences (`\x1b[ … cmd`) and OSC sequences (`\x1b] … BEL/ST`).
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** Remove every ANSI escape sequence, returning the plain text. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

const SGR_RE = /\x1b\[([0-9;]*)m/g;

/** Parse a stream into styled segments, tracking SGR state across the input. */
export function parseAnsi(text: string): Segment[] {
  const segments: Segment[] = [];
  let style: Style = {};
  let lastIndex = 0;

  SGR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  const pushText = (raw: string) => {
    if (raw === "") return;
    // Drop any non-SGR escape sequences embedded in the run.
    const clean = stripAnsi(raw);
    if (clean !== "") segments.push({ text: clean, style: { ...style } });
  };

  while ((match = SGR_RE.exec(text)) !== null) {
    pushText(text.slice(lastIndex, match.index));
    style = applySgr(style, parseParams(match[1]));
    lastIndex = SGR_RE.lastIndex;
  }
  pushText(text.slice(lastIndex));
  return segments;
}

function parseParams(raw: string): number[] {
  if (raw === "") return [0]; // `\x1b[m` is equivalent to reset
  return raw.split(";").map((p) => (p === "" ? 0 : parseInt(p, 10)));
}

function applySgr(prev: Style, params: number[]): Style {
  const style: Style = { ...prev };
  for (let i = 0; i < params.length; i++) {
    const code = params[i];
    switch (code) {
      case 0: return {}; // full reset
      case 1: style.bold = true; break;
      case 2: style.dim = true; break;
      case 3: style.italic = true; break;
      case 4: style.underline = true; break;
      case 7: style.inverse = true; break;
      case 9: style.strikethrough = true; break;
      case 22: delete style.bold; delete style.dim; break;
      case 23: delete style.italic; break;
      case 24: delete style.underline; break;
      case 27: delete style.inverse; break;
      case 29: delete style.strikethrough; break;
      case 39: delete style.fg; break;
      case 49: delete style.bg; break;
      case 38: i = consumeExtendedColor(params, i, style, "fg"); break;
      case 48: i = consumeExtendedColor(params, i, style, "bg"); break;
      default:
        if (code >= 30 && code <= 37) style.fg = code - 30;
        else if (code >= 90 && code <= 97) style.fg = code - 90 + 8;
        else if (code >= 40 && code <= 47) style.bg = code - 40;
        else if (code >= 100 && code <= 107) style.bg = code - 100 + 8;
        break;
    }
  }
  return style;
}

/** Handle `38;5;n` (256-color) and `38;2;r;g;b` (truecolor); returns new index. */
function consumeExtendedColor(params: number[], i: number, style: Style, slot: "fg" | "bg"): number {
  const mode = params[i + 1];
  if (mode === 5) {
    style[slot] = params[i + 2] ?? 0;
    return i + 2;
  }
  if (mode === 2) {
    style[slot] = { r: params[i + 2] ?? 0, g: params[i + 3] ?? 0, b: params[i + 4] ?? 0 };
    return i + 4;
  }
  return i + 1;
}
