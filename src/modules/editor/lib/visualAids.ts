// Editor visual aids: rainbow brackets (with unmatched brackets flagged),
// indentation rainbow, and sticky scroll (enclosing block headers pinned to
// the top while scrolling).

import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { computeBracketPairs } from "@/lib/lang/bracketPairs";
import { getFeature } from "@/modules/settings/useFeature";

const MAX_DOC = 600_000;
const BRACKET_COLORS = 6;

// ── rainbow brackets ──────────────────────────────────────────────────────

const depthMarks = Array.from({ length: BRACKET_COLORS }, (_, i) => Decoration.mark({ class: `cm-rb cm-rb-${i}` }));
const unmatchedMark = Decoration.mark({ class: "cm-rb-bad", attributes: { title: "Unmatched bracket" } });

function buildBrackets(view: EditorView, languageId: string): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  if (!getFeature("editor.rainbowBrackets") || view.state.doc.length > MAX_DOC) return b.finish();
  const analysis = computeBracketPairs(view.state.doc.toString(), languageId);
  const marks: { from: number; to: number; deco: Decoration }[] = [];
  const { from: vFrom, to: vTo } = view.viewport;
  for (const p of analysis.pairs) {
    for (const pos of [p.open, p.close]) {
      if (pos.to >= vFrom && pos.from <= vTo) marks.push({ from: pos.from, to: pos.to, deco: depthMarks[p.depth % BRACKET_COLORS] });
    }
  }
  for (const u of analysis.unmatched) if (u.to >= vFrom && u.from <= vTo) marks.push({ from: u.from, to: u.to, deco: unmatchedMark });
  marks.sort((x, y) => x.from - y.from);
  for (const m of marks) b.add(m.from, m.to, m.deco);
  return b.finish();
}

export function rainbowBrackets(getLanguage: () => string): Extension {
  let enabled = getFeature("editor.rainbowBrackets");
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = buildBrackets(view, getLanguage());
        }
        update(u: ViewUpdate) {
          const now = getFeature("editor.rainbowBrackets");
          if (u.docChanged || u.viewportChanged || now !== enabled) {
            enabled = now;
            this.decorations = buildBrackets(u.view, getLanguage());
          }
        }
      },
      { decorations: (v) => v.decorations },
    ),
    EditorView.baseTheme({
      "&light .cm-rb-0": { color: "#b8860b" },
      "&light .cm-rb-1": { color: "#a626a4" },
      "&light .cm-rb-2": { color: "#0f6fc6" },
      "&light .cm-rb-3": { color: "#2e8b57" },
      "&light .cm-rb-4": { color: "#c2410c" },
      "&light .cm-rb-5": { color: "#0e7490" },
      "&dark .cm-rb-0": { color: "#ffd700" },
      "&dark .cm-rb-1": { color: "#da70d6" },
      "&dark .cm-rb-2": { color: "#4fb3ff" },
      "&dark .cm-rb-3": { color: "#7ee787" },
      "&dark .cm-rb-4": { color: "#ffa657" },
      "&dark .cm-rb-5": { color: "#56d4dd" },
      ".cm-rb-bad": { color: "#ef4444 !important", textDecoration: "underline wavy #ef4444", textUnderlineOffset: "3px" },
    }),
  ];
}

// ── indentation rainbow ───────────────────────────────────────────────────

const indentMarks = Array.from({ length: 4 }, (_, i) => Decoration.mark({ class: `cm-ir cm-ir-${i}` }));

/** Ranges of each indent level in a line's leading whitespace (tabs = one level). */
export function indentLevels(text: string, unit: number): { from: number; to: number; level: number }[] {
  const out: { from: number; to: number; level: number }[] = [];
  let col = 0;
  let start = 0;
  let level = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\t") {
      out.push({ from: i, to: i + 1, level: level++ });
      start = i + 1;
      col = 0;
    } else if (c === " ") {
      col++;
      if (col === unit) {
        out.push({ from: start, to: i + 1, level: level++ });
        start = i + 1;
        col = 0;
      }
    } else break;
  }
  return out;
}

function buildIndent(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  if (!getFeature("editor.indentRainbow")) return b.finish();
  const unit = detectUnit(view);
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      if (line.text.trim()) for (const r of indentLevels(line.text, unit)) b.add(line.from + r.from, line.from + r.to, indentMarks[r.level % 4]);
      pos = line.to + 1;
    }
  }
  return b.finish();
}

function detectUnit(view: EditorView): number {
  const counts = new Map<number, number>();
  const lines = Math.min(view.state.doc.lines, 400);
  let prev = 0;
  for (let i = 1; i <= lines; i++) {
    const t = view.state.doc.line(i).text;
    if (!t.trim()) continue;
    const n = /^ */.exec(t)![0].length;
    const d = Math.abs(n - prev);
    if (d >= 2 && d <= 8) counts.set(d, (counts.get(d) ?? 0) + 1);
    prev = n;
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 2;
}

export function indentRainbow(): Extension {
  let enabled = getFeature("editor.indentRainbow");
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = buildIndent(view);
        }
        update(u: ViewUpdate) {
          const now = getFeature("editor.indentRainbow");
          if (u.docChanged || u.viewportChanged || now !== enabled) {
            enabled = now;
            this.decorations = buildIndent(u.view);
          }
        }
      },
      { decorations: (v) => v.decorations },
    ),
    EditorView.baseTheme({
      ".cm-ir-0": { backgroundColor: "rgba(255, 255, 64, 0.07)" },
      ".cm-ir-1": { backgroundColor: "rgba(127, 255, 127, 0.07)" },
      ".cm-ir-2": { backgroundColor: "rgba(255, 127, 255, 0.07)" },
      ".cm-ir-3": { backgroundColor: "rgba(79, 236, 236, 0.07)" },
    }),
  ];
}

// ── sticky scroll ─────────────────────────────────────────────────────────

const HEADER = /^\s*((export|pub(\(\w+\))?|public|private|protected|static|async|default|abstract|override|final)\s+)*(function|class|interface|enum|struct|impl|trait|mod|fn|def|func|module|namespace|describe|it|test|if|else|for|while|switch|match|case|try|with|object|record)\b|[{:]\s*(\/\/.*|#.*)?$|=>\s*\{?\s*$|^#{1,6}\s/;

/** Line numbers of the blocks enclosing `lineNo` (outermost first), by indentation. */
export function enclosingHeaders(lines: (n: number) => string, lineNo: number, max = 5): number[] {
  const out: number[] = [];
  const target = lines(lineNo);
  let indent = target.trim() ? /^\s*/.exec(target)![0].replace(/\t/g, "    ").length : Infinity;
  // Markdown: enclosing headings by level instead of indentation.
  const md = /^#{1,6}\s/.test(target) || false;
  let mdLevel = md ? /^#+/.exec(target)![0].length : 7;
  for (let n = lineNo - 1; n >= 1 && out.length < max; n--) {
    const t = lines(n);
    if (!t.trim()) continue;
    const h = /^(#{1,6})\s/.exec(t);
    if (h) {
      if (h[1].length < mdLevel) {
        out.unshift(n);
        mdLevel = h[1].length;
      }
      continue;
    }
    const ind = /^\s*/.exec(t)![0].replace(/\t/g, "    ").length;
    if (ind < indent && HEADER.test(t)) {
      out.unshift(n);
      indent = ind;
      if (ind === 0) break;
    } else if (ind < indent) indent = ind;
  }
  return out.slice(-max);
}

class StickyPlugin {
  dom: HTMLElement;
  private raf = 0;
  private onScroll = () => {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.render());
  };
  constructor(readonly view: EditorView) {
    // An overlay on the editor (outside the scroller) so it never shifts layout.
    this.dom = document.createElement("div");
    this.dom.className = "cm-sticky";
    view.dom.appendChild(this.dom);
    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
    this.render();
  }
  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || u.geometryChanged) this.render();
  }
  render() {
    const view = this.view;
    if (!getFeature("editor.stickyScroll") || view.scrollDOM.scrollTop < 4) {
      this.dom.style.display = "none";
      return;
    }
    const doc = view.state.doc;
    const lineHeight = view.defaultLineHeight;
    // Leave room for the pinned rows themselves when picking the first visible line.
    let first = doc.lineAt(view.lineBlockAtHeight(view.scrollDOM.scrollTop).from).number;
    let pinned = enclosingHeaders((n) => doc.line(n).text, first).filter((n) => n < first);
    first = doc.lineAt(view.lineBlockAtHeight(view.scrollDOM.scrollTop + pinned.length * lineHeight).from).number;
    pinned = enclosingHeaders((n) => doc.line(n).text, first).filter((n) => n < first);
    if (!pinned.length) {
      this.dom.style.display = "none";
      return;
    }
    const gutter = view.dom.querySelector(".cm-gutters") as HTMLElement | null;
    this.dom.style.display = "";
    this.dom.style.left = `${gutter?.offsetWidth ?? 0}px`;
    // Match the theme's editor background (it may live on any of these layers).
    const bg = [view.scrollDOM, view.dom, view.dom.parentElement].map((el) => (el ? getComputedStyle(el).backgroundColor : "")).find((c) => c && c !== "transparent" && !/rgba\(.*,\s*0\)$/.test(c));
    if (bg) this.dom.style.backgroundColor = bg;
    this.dom.replaceChildren(
      ...pinned.map((n) => {
        const row = document.createElement("div");
        row.className = "cm-sticky-line";
        row.style.height = `${lineHeight}px`;
        row.style.lineHeight = `${lineHeight}px`;
        row.textContent = doc.line(n).text.replace(/\t/g, "    ");
        row.title = `Line ${n}`;
        row.onmousedown = (e) => {
          e.preventDefault();
          view.dispatch({ selection: { anchor: doc.line(n).from }, effects: EditorView.scrollIntoView(doc.line(n).from, { y: "start" }) });
          view.focus();
        };
        return row;
      }),
    );
  }
  destroy() {
    cancelAnimationFrame(this.raf);
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    this.dom.remove();
  }
}

export function stickyScroll(): Extension {
  return [
    ViewPlugin.fromClass(StickyPlugin),
    EditorView.baseTheme({
      ".cm-sticky": {
        position: "absolute",
        top: "0",
        right: "0",
        zIndex: "5",
        backgroundColor: "var(--background, #1e1e1e)",
        borderBottom: "1px solid color-mix(in srgb, currentColor 15%, transparent)",
        boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
        fontFamily: "var(--font-mono, monospace)",
        fontSize: "inherit",
        cursor: "pointer",
      },
      ".cm-sticky-line": {
        whiteSpace: "pre",
        overflow: "hidden",
        textOverflow: "ellipsis",
        padding: "0 8px 0 6px",
        opacity: "0.85",
      },
      ".cm-sticky-line:hover": { opacity: "1", textDecoration: "underline" },
    }),
  ];
}
