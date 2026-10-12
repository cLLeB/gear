// Code as a picture: turning highlighted source into lines of coloured runs,
// and working out the size of the image. Drawing happens in the pane.

export interface Span {
  from: number;
  to: number;
  /** Highlighter classes, e.g. "tok-keyword tok-definition". */
  classes: string;
}

export interface Run {
  text: string;
  color: string;
  bold?: boolean;
  italic?: boolean;
}

export interface Theme {
  id: string;
  name: string;
  /** Behind the code. */
  surface: string;
  text: string;
  lineNumber: string;
  title: string;
  /** Token class (without "tok-") -> colour. */
  tokens: Record<string, string>;
}

export const THEMES: Theme[] = [
  {
    id: "night",
    name: "Night",
    surface: "#1e2030",
    text: "#c8d3f5",
    lineNumber: "#545c7e",
    title: "#828bb8",
    tokens: { keyword: "#c099ff", string: "#c3e88d", comment: "#7a88cf", number: "#ff966c", bool: "#ff966c", atom: "#ff966c", typeName: "#65bcff", className: "#65bcff", variableName2: "#ff757f", propertyName: "#82aaff", operator: "#89ddff", punctuation: "#89ddff", meta: "#ffc777", function: "#82aaff", definition: "#82aaff", regexp: "#b4f9f8", escape: "#b4f9f8", link: "#4fd6be", url: "#4fd6be", heading: "#82aaff", tagName: "#ff757f", attributeName: "#c099ff", invalid: "#ff5370", namespace: "#ffc777", labelName: "#ffc777", macroName: "#ffc777", literal: "#ff966c" },
  },
  {
    id: "paper",
    name: "Paper",
    surface: "#ffffff",
    text: "#24292f",
    lineNumber: "#a0a8b3",
    title: "#6e7781",
    tokens: { keyword: "#cf222e", string: "#0a3069", comment: "#6e7781", number: "#0550ae", bool: "#0550ae", atom: "#0550ae", typeName: "#953800", className: "#953800", variableName2: "#0550ae", propertyName: "#0550ae", operator: "#cf222e", punctuation: "#24292f", meta: "#8250df", function: "#8250df", definition: "#8250df", regexp: "#116329", escape: "#116329", link: "#0969da", url: "#0969da", heading: "#0550ae", tagName: "#116329", attributeName: "#0550ae", invalid: "#82071e", namespace: "#953800", labelName: "#953800", macroName: "#8250df", literal: "#0550ae" },
  },
  {
    id: "dusk",
    name: "Dusk",
    surface: "#282a36",
    text: "#f8f8f2",
    lineNumber: "#6272a4",
    title: "#8b93b8",
    tokens: { keyword: "#ff79c6", string: "#f1fa8c", comment: "#6272a4", number: "#bd93f9", bool: "#bd93f9", atom: "#bd93f9", typeName: "#8be9fd", className: "#8be9fd", variableName2: "#ffb86c", propertyName: "#66d9ef", operator: "#ff79c6", punctuation: "#f8f8f2", meta: "#50fa7b", function: "#50fa7b", definition: "#50fa7b", regexp: "#ffb86c", escape: "#ffb86c", link: "#8be9fd", url: "#8be9fd", heading: "#bd93f9", tagName: "#ff79c6", attributeName: "#50fa7b", invalid: "#ff5555", namespace: "#8be9fd", labelName: "#8be9fd", macroName: "#50fa7b", literal: "#bd93f9" },
  },
  {
    id: "mono",
    name: "Ink",
    surface: "#fbfaf7",
    text: "#1c1c1c",
    lineNumber: "#b8b4aa",
    title: "#8a867c",
    tokens: { keyword: "#1c1c1c", comment: "#9a968c", string: "#4d4a44" },
  },
];

export const BACKDROPS: { id: string; name: string; colors: string[] }[] = [
  { id: "none", name: "None", colors: [] },
  { id: "dawn", name: "Dawn", colors: ["#ff9a8b", "#ff6a88", "#ff99ac"] },
  { id: "sea", name: "Sea", colors: ["#43cea2", "#185a9d"] },
  { id: "plum", name: "Plum", colors: ["#8e2de2", "#4a00e0"] },
  { id: "sand", name: "Sand", colors: ["#f6d365", "#fda085"] },
  { id: "slate", name: "Slate", colors: ["#3a4a5c", "#1b2430"] },
  { id: "mist", name: "Mist", colors: ["#e6e9f0", "#cfd6e4"] },
];

const BOLD = new Set(["keyword", "heading", "strong"]);
const ITALIC = new Set(["comment", "emphasis"]);
/** More specific classes win over general ones when a token has several. */
const PRIORITY = ["invalid", "comment", "string", "regexp", "escape", "number", "bool", "atom", "keyword", "macroName", "typeName", "className", "namespace", "tagName", "attributeName", "propertyName", "function", "definition", "variableName2", "labelName", "heading", "link", "url", "meta", "operator", "literal", "punctuation"];

export function styleFor(classes: string, theme: Theme): { color: string; bold: boolean; italic: boolean } {
  const names = classes.split(/\s+/).map((c) => c.replace(/^tok-/, "")).filter(Boolean);
  const hit = PRIORITY.find((p) => names.includes(p) && theme.tokens[p]);
  return { color: hit ? theme.tokens[hit] : theme.text, bold: names.some((n) => BOLD.has(n)), italic: names.some((n) => ITALIC.has(n)) };
}

export function expandTabs(line: string, tabSize: number): string {
  let out = "";
  for (const ch of line) out += ch === "\t" ? " ".repeat(tabSize - (out.length % tabSize)) : ch;
  return out;
}

/** The smallest indentation shared by every non-blank line. */
export function commonIndent(lines: string[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const l of lines) if (l.trim()) min = Math.min(min, /^ */.exec(l)?.[0].length ?? 0);
  return Number.isFinite(min) ? min : 0;
}

/**
 * Lines of coloured runs for `text`, which starts at offset `base` of the
 * document the spans refer to. Shared indentation is removed when `dedent` is set.
 */
export function toLines(text: string, spans: Span[], theme: Theme, opts: { base?: number; tabSize?: number; dedent?: boolean } = {}): Run[][] {
  const base = opts.base ?? 0;
  const tabSize = opts.tabSize ?? 2;
  const sorted = [...spans].sort((a, b) => a.from - b.from);
  const raw = text.replace(/\r\n?/g, "\n").split("\n");
  // Offsets are measured in the original text, before \r is dropped.
  const cut = opts.dedent ? commonIndent(raw.map((l) => expandTabs(l, tabSize))) : 0;
  const out: Run[][] = [];
  let offset = base;
  let si = 0;
  const original = text.split("\n");
  for (const [i, line] of raw.entries()) {
    const runs: Run[] = [];
    let col = 0;
    let at = 0;
    const push = (chunk: string, classes: string) => {
      if (!chunk) return;
      let shown = "";
      for (const ch of chunk) {
        const piece = ch === "\t" ? " ".repeat(tabSize - (col % tabSize)) : ch;
        for (const p of piece) {
          if (col >= cut) shown += p;
          col++;
        }
      }
      if (!shown) return;
      const s = styleFor(classes, theme);
      const last = runs[runs.length - 1];
      if (last && last.color === s.color && Boolean(last.bold) === s.bold && Boolean(last.italic) === s.italic) last.text += shown;
      else runs.push({ text: shown, color: s.color, ...(s.bold ? { bold: true } : {}), ...(s.italic ? { italic: true } : {}) });
    };
    const lineEnd = offset + line.length;
    while (si < sorted.length && sorted[si].to <= offset) si++;
    let k = si;
    while (at < line.length) {
      const pos = offset + at;
      while (k < sorted.length && sorted[k].to <= pos) k++;
      const span = sorted[k];
      if (!span || span.from >= lineEnd) {
        push(line.slice(at), "");
        break;
      }
      if (span.from > pos) {
        push(line.slice(at, span.from - offset), "");
        at = span.from - offset;
        continue;
      }
      const end = Math.min(span.to, lineEnd) - offset;
      push(line.slice(at, end), span.classes);
      at = end;
    }
    out.push(runs);
    // +1 for the newline, +1 more when the original line ended in \r\n.
    offset = lineEnd + 1 + ((original[i] ?? "").endsWith("\r") ? 1 : 0);
  }
  // Blank lines at either end only add empty space to the picture.
  while (out.length > 1 && out[out.length - 1].length === 0) out.pop();
  while (out.length > 1 && out[0].length === 0) out.shift();
  return out;
}

export interface Options {
  fontSize: number;
  lineNumbers: boolean;
  /** Number of the first line shown. */
  firstLine: number;
  /** Space between the backdrop's edge and the code window. */
  margin: number;
  windowChrome: boolean;
  title: string;
}

export interface Layout {
  width: number;
  height: number;
  /** The code window inside the image. */
  window: { x: number; y: number; w: number; h: number };
  /** Where the first line's baseline box starts. */
  codeX: number;
  codeY: number;
  lineHeight: number;
  gutterWidth: number;
  headerHeight: number;
}

/** Sizes in CSS pixels; `charWidth` is the width of one character at this font size. */
export function layout(lines: Run[][], charWidth: number, o: Options): Layout {
  const columns = lines.reduce((m, runs) => Math.max(m, runs.reduce((a, r) => a + [...r.text].length, 0)), 0);
  const lineHeight = Math.round(o.fontSize * 1.55);
  const pad = Math.round(o.fontSize * 1.3);
  const digits = String(o.firstLine + lines.length - 1).length;
  const gutterWidth = o.lineNumbers ? Math.ceil((digits + 2) * charWidth) : 0;
  const headerHeight = o.windowChrome || o.title ? Math.round(o.fontSize * 2.6) : 0;
  const minColumns = o.title ? Math.min(60, [...o.title].length + 12) : 24;
  const w = Math.ceil(pad * 2 + gutterWidth + Math.max(columns, minColumns) * charWidth);
  const h = headerHeight + (headerHeight ? Math.round(pad * 0.4) : pad) + lines.length * lineHeight + pad;
  return { width: w + o.margin * 2, height: h + o.margin * 2, window: { x: o.margin, y: o.margin, w, h }, codeX: o.margin + pad + gutterWidth, codeY: o.margin + headerHeight + (headerHeight ? Math.round(pad * 0.4) : pad), lineHeight, gutterWidth, headerHeight };
}

/** A file name for the picture, from the source file and line range. */
export function imageName(path: string | null, firstLine: number, count: number): string {
  const base = (path?.split(/[\\/]/).pop() ?? "code").replace(/[^A-Za-z0-9._-]+/g, "-");
  return `${base}-L${firstLine}${count > 1 ? `-${firstLine + count - 1}` : ""}.png`;
}
