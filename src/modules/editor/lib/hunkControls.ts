// Per-hunk Stage / Unstage / Discard buttons for the git diff tab. Reads the
// chunks computed by @codemirror/merge's unifiedMergeView (so it must be
// listed after it) and reports the new-side line range of the clicked hunk.

import { getChunks } from "@codemirror/merge";
import { type EditorState, type Extension, RangeSetBuilder, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

export type HunkAction = "stage" | "unstage" | "discard";

/** New-side (1-based, inclusive) line range of a chunk, as `git diff` numbers lines. */
export function chunkLines(doc: Text, fromB: number, toB: number): { from: number; to: number } {
  if (fromB >= toB) {
    // Pure deletion: git anchors it at the line that now follows it.
    const line = doc.lineAt(Math.min(fromB, doc.length)).number;
    return { from: line, to: line };
  }
  const from = doc.lineAt(fromB).number;
  const to = doc.lineAt(Math.max(fromB, toB - 1)).number;
  return { from, to };
}

class HunkBar extends WidgetType {
  constructor(
    readonly lines: { from: number; to: number },
    readonly actions: HunkAction[],
    readonly onAction: (a: HunkAction, from: number, to: number) => void,
    readonly index: number,
    readonly total: number,
  ) {
    super();
  }
  eq(o: HunkBar) {
    return o.lines.from === this.lines.from && o.lines.to === this.lines.to && o.index === this.index && o.total === this.total;
  }
  toDOM() {
    const bar = document.createElement("div");
    bar.className = "cm-hunk-bar";
    const label = document.createElement("span");
    label.className = "cm-hunk-label";
    label.textContent = `Hunk ${this.index + 1}/${this.total} · lines ${this.lines.from}${this.lines.to !== this.lines.from ? `–${this.lines.to}` : ""}`;
    bar.appendChild(label);
    const names: Record<HunkAction, string> = { stage: "Stage hunk", unstage: "Unstage hunk", discard: "Discard hunk" };
    for (const a of this.actions) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `cm-hunk-btn cm-hunk-${a}`;
      b.textContent = names[a];
      b.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.onAction(a, this.lines.from, this.lines.to);
      };
      bar.appendChild(b);
    }
    return bar;
  }
  ignoreEvent() {
    return true;
  }
}

function build(state: EditorState, actions: HunkAction[], onAction: HunkBar["onAction"]): DecorationSet {
  const info = getChunks(state);
  const b = new RangeSetBuilder<Decoration>();
  if (!info) return b.finish();
  const chunks = info.chunks;
  chunks.forEach((c, i) => {
    const lines = chunkLines(state.doc, c.fromB, c.toB);
    // Sit above the chunk's deleted lines, which the merge view draws as a widget at fromB.
    const at = c.fromB < state.doc.length || c.fromB === 0 ? state.doc.lineAt(c.fromB).from : state.doc.line(state.doc.lines).from;
    b.add(at, at, Decoration.widget({ widget: new HunkBar(lines, actions, onAction, i, chunks.length), block: true, side: -10_000 }));
  });
  return b.finish();
}

/** Hunk action bars; list this after `unifiedMergeView(...)`. */
export function hunkControls(actions: HunkAction[], onAction: (a: HunkAction, from: number, to: number) => void): Extension {
  const field = StateField.define<DecorationSet>({
    create: (s) => build(s, actions, onAction),
    update: (v, tr) => (tr.docChanged || tr.reconfigured || getChunks(tr.startState)?.chunks !== getChunks(tr.state)?.chunks ? build(tr.state, actions, onAction) : v),
    provide: (f) => EditorView.decorations.from(f),
  });
  return [
    field,
    EditorView.baseTheme({
      ".cm-hunk-bar": {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "2px 8px",
        fontFamily: "var(--font-sans, system-ui)",
        fontSize: "10.5px",
        borderTop: "1px solid color-mix(in srgb, currentColor 12%, transparent)",
        background: "color-mix(in srgb, currentColor 4%, transparent)",
      },
      ".cm-hunk-label": { opacity: "0.6", marginRight: "auto" },
      ".cm-hunk-btn": {
        font: "inherit",
        cursor: "pointer",
        border: "1px solid color-mix(in srgb, currentColor 22%, transparent)",
        borderRadius: "4px",
        background: "transparent",
        color: "inherit",
        padding: "0 6px",
        lineHeight: "16px",
      },
      ".cm-hunk-btn:hover": { background: "color-mix(in srgb, currentColor 12%, transparent)" },
      ".cm-hunk-stage": { color: "#16a34a" },
      ".cm-hunk-discard": { color: "#dc2626" },
    }),
  ];
}
