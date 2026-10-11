// Flag characters that make code read differently from how it runs — bidi
// controls ("Trojan Source"), zero-width characters, look-alike spaces and
// Cyrillic/Greek homoglyphs inside Latin words — in the visible viewport.

import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { getFeature } from "@/modules/settings/useFeature";
import { findSuspiciousChars } from "./textTools/textMisc";

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  if (!getFeature("editor.suspiciousChars")) return b.finish();
  for (const { from, to } of view.visibleRanges) {
    const start = view.state.doc.lineAt(from).from;
    const end = view.state.doc.lineAt(to).to;
    for (const hit of findSuspiciousChars(view.state.sliceDoc(start, end))) {
      b.add(
        start + hit.from,
        start + hit.to,
        Decoration.mark({ class: `cm-suspicious cm-suspicious-${hit.kind}`, attributes: { title: hit.label } }),
      );
    }
  }
  return b.finish();
}

const theme = EditorView.baseTheme({
  ".cm-suspicious": { textDecoration: "underline wavy", textDecorationSkipInk: "none", textUnderlineOffset: "3px" },
  ".cm-suspicious-bidi, .cm-suspicious-invisible": {
    textDecorationColor: "#dc2626",
    backgroundColor: "rgba(239, 68, 68, 0.22)",
    // Zero-width characters have no box; padding gives the mark something to show.
    padding: "0 1px",
  },
  ".cm-suspicious-space": { textDecorationColor: "#d97706", backgroundColor: "rgba(245, 158, 11, 0.2)" },
  ".cm-suspicious-homoglyph": { textDecorationColor: "#dc2626" },
});

export function suspiciousChars() {
  let enabled = getFeature("editor.suspiciousChars");
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = build(view);
        }
        update(u: ViewUpdate) {
          const now = getFeature("editor.suspiciousChars");
          if (u.docChanged || u.viewportChanged || now !== enabled) {
            enabled = now;
            this.decorations = build(u.view);
          }
        }
      },
      { decorations: (v) => v.decorations },
    ),
    theme,
  ];
}
