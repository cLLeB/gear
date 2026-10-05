// Inline merge-conflict resolution: a lens row above each conflict with
// Accept Current / Accept Incoming / Accept Both (and Base for diff3), plus
// tinted current/incoming sections. Recomputed only when the document
// actually contains conflict markers.

import { type EditorState, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { parseConflicts, resolve, type ConflictBlock, type Resolution } from "./textTools/conflicts";

function applyResolution(view: EditorView, from: number, how: Resolution): void {
  const block = parseConflicts(view.state.doc.toString()).find((b) => b.from === from);
  if (!block) return;
  view.dispatch({ changes: { from: block.from, to: block.to, insert: resolve(block, how) }, userEvent: "input" });
  view.focus();
}

class LensWidget extends WidgetType {
  constructor(readonly block: ConflictBlock) {
    super();
  }
  eq(o: LensWidget) {
    return o.block.from === this.block.from && o.block.base === this.block.base;
  }
  toDOM(view: EditorView) {
    const row = document.createElement("div");
    row.className = "cm-conflict-lens";
    const add = (label: string, how: Resolution, title: string) => {
      const a = document.createElement("button");
      a.type = "button";
      a.textContent = label;
      a.title = title;
      a.addEventListener("mousedown", (e) => {
        e.preventDefault();
        applyResolution(view, this.block.from, how);
      });
      row.appendChild(a);
    };
    add("Accept current", "current", `Keep ${this.block.currentLabel}`);
    add("Accept incoming", "incoming", `Take ${this.block.incomingLabel}`);
    add("Accept both", "both", "Current followed by incoming");
    if (this.block.base !== null) add("Accept base", "base", "Common ancestor (diff3)");
    if (!view.dom.closest(".cm-merge-result")) {
      const m = document.createElement("button");
      m.type = "button";
      m.textContent = "Open merge editor";
      m.title = "Resolve side by side (ours | result | theirs)";
      m.addEventListener("mousedown", (e) => {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("gear:open-merge-editor"));
      });
      row.appendChild(m);
    }
    return row;
  }
  ignoreEvent() {
    return false;
  }
}

const currentLine = Decoration.line({ class: "cm-conflict-current" });
const incomingLine = Decoration.line({ class: "cm-conflict-incoming" });
const markerLine = Decoration.line({ class: "cm-conflict-marker" });

function build(state: EditorState): DecorationSet {
  const text = state.doc.toString();
  if (!text.includes("<<<<<<<")) return Decoration.none;
  const b = new RangeSetBuilder<Decoration>();
  for (const block of parseConflicts(text)) {
    b.add(block.from, block.from, Decoration.widget({ widget: new LensWidget(block), side: -1, block: true }));
    let section: "current" | "base" | "incoming" = "current";
    for (let pos = block.from; pos < block.to; ) {
      const line = state.doc.lineAt(pos);
      if (/^(<{7}|\|{7}|={7}|>{7})/.test(line.text)) {
        b.add(line.from, line.from, markerLine);
        if (line.text.startsWith("|||||||")) section = "base";
        if (line.text.startsWith("=======")) section = "incoming";
      } else if (section !== "base") {
        b.add(line.from, line.from, section === "current" ? currentLine : incomingLine);
      }
      pos = line.to + 1;
    }
  }
  return b.finish();
}

const field = StateField.define<DecorationSet>({
  create: build,
  update: (deco, tr) => (tr.docChanged ? build(tr.state) : deco),
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.baseTheme({
  ".cm-conflict-lens": { display: "flex", gap: "10px", fontSize: "0.8em", padding: "2px 6px", opacity: "0.85" },
  ".cm-conflict-lens button": {
    background: "none",
    border: "none",
    padding: "0",
    color: "var(--color-primary, #3b82f6)",
    cursor: "pointer",
  },
  ".cm-conflict-lens button:hover": { textDecoration: "underline" },
  ".cm-conflict-current": { backgroundColor: "rgba(34, 197, 94, 0.12)" },
  ".cm-conflict-incoming": { backgroundColor: "rgba(59, 130, 246, 0.12)" },
  ".cm-conflict-marker": { backgroundColor: "rgba(127, 127, 127, 0.15)", fontWeight: "600" },
});

export function conflictLens() {
  return [field, theme];
}

/** Resolve the conflict containing the main cursor. */
export function resolveConflictAtCursor(view: EditorView, how: Resolution): boolean {
  const head = view.state.selection.main.head;
  const block = parseConflicts(view.state.doc.toString()).find((b) => head >= b.from && head < b.to);
  if (!block) return false;
  view.dispatch({ changes: { from: block.from, to: block.to, insert: resolve(block, how) }, userEvent: "input" });
  return true;
}

export function gotoConflict(view: EditorView, dir: 1 | -1): boolean {
  const blocks = parseConflicts(view.state.doc.toString());
  if (blocks.length === 0) return false;
  const head = view.state.selection.main.head;
  const target =
    dir > 0
      ? (blocks.find((b) => b.from > head) ?? blocks[0])
      : ([...blocks].reverse().find((b) => b.from < head && !(head >= b.from && head < b.to)) ?? blocks[blocks.length - 1]);
  view.dispatch({ selection: { anchor: target.from }, effects: EditorView.scrollIntoView(target.from, { y: "center" }) });
  return true;
}
