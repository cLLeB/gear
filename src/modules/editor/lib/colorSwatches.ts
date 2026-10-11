// Inline colour swatches before CSS colour literals (VS Code's colour
// decorators). Clicking a swatch cycles the literal's notation
// hex → rgb → hsl. Only the visible ranges are scanned.

import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { getFeature } from "@/modules/settings/useFeature";
import { findColors, formatColor, nextFormat, type FoundColor } from "./textTools/colors";

const MAX_PER_VIEW = 400;

class SwatchWidget extends WidgetType {
  constructor(readonly found: FoundColor) {
    super();
  }
  eq(other: SwatchWidget) {
    return other.found.text === this.found.text && other.found.from === this.found.from;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    const { r, g, b, a } = this.found.color;
    el.className = "cm-color-swatch";
    el.style.setProperty("--swatch", `rgba(${r}, ${g}, ${b}, ${a})`);
    el.title = `${this.found.text} — click to convert to ${nextFormat(this.found.format)}`;
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const next = formatColor(this.found.color, nextFormat(this.found.format));
      // Re-find the literal at the widget's current position (the doc may have shifted).
      const pos = view.posAtDOM(el);
      const line = view.state.doc.lineAt(pos);
      const hit = findColors(line.text, line.from).find((c) => c.from === pos);
      if (!hit) return;
      view.dispatch({ changes: { from: hit.from, to: hit.to, insert: next }, userEvent: "input" });
    });
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  if (!getFeature("editor.colorSwatches")) return builder.finish();
  let n = 0;
  for (const { from, to } of view.visibleRanges) {
    for (const found of findColors(view.state.sliceDoc(from, to), from)) {
      if (n++ >= MAX_PER_VIEW) return builder.finish();
      builder.add(found.from, found.from, Decoration.widget({ widget: new SwatchWidget(found), side: -1 }));
    }
  }
  return builder.finish();
}

const swatchTheme = EditorView.baseTheme({
  ".cm-color-swatch": {
    display: "inline-block",
    width: "0.8em",
    height: "0.8em",
    marginRight: "0.25em",
    verticalAlign: "-0.05em",
    borderRadius: "2px",
    cursor: "pointer",
    outline: "1px solid color-mix(in srgb, currentColor 35%, transparent)",
    // Checkerboard under the colour so transparency is visible.
    background:
      "linear-gradient(var(--swatch), var(--swatch)), repeating-conic-gradient(#999 0% 25%, #fff 0% 50%) 0 0 / 0.4em 0.4em",
  },
});

export function colorSwatches() {
  let enabled = getFeature("editor.colorSwatches");
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = build(view);
        }
        update(u: ViewUpdate) {
          const now = getFeature("editor.colorSwatches");
          if (u.docChanged || u.viewportChanged || now !== enabled) {
            enabled = now;
            this.decorations = build(u.view);
          }
        }
      },
      { decorations: (v) => v.decorations },
    ),
    swatchTheme,
  ];
}
