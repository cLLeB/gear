// Highlight TODO-style tags in comments in the visible part of the editor.

import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { getFeature } from "@/modules/settings/useFeature";
import { parseTodo, type TodoTag } from "./textTools/todos";

const URGENT = new Set<TodoTag>(["FIXME", "BUG", "XXX"]);

const marks = {
  urgent: Decoration.mark({ class: "cm-todo-tag cm-todo-urgent" }),
  normal: Decoration.mark({ class: "cm-todo-tag" }),
  note: Decoration.mark({ class: "cm-todo-tag cm-todo-note" }),
};

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  if (!getFeature("editor.todoHighlight")) return b.finish();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      const hit = parseTodo(line.text);
      if (hit) {
        const start = line.from + hit.index;
        const mark = URGENT.has(hit.tag) ? marks.urgent : hit.tag === "NOTE" ? marks.note : marks.normal;
        b.add(start, start + hit.tag.length, mark);
      }
      pos = line.to + 1;
    }
  }
  return b.finish();
}

const theme = EditorView.baseTheme({
  ".cm-todo-tag": {
    fontWeight: "600",
    borderRadius: "3px",
    padding: "0 2px",
    color: "#b45309",
    backgroundColor: "rgba(245, 158, 11, 0.16)",
  },
  ".cm-todo-urgent": { color: "#dc2626", backgroundColor: "rgba(239, 68, 68, 0.16)" },
  ".cm-todo-note": { color: "#2563eb", backgroundColor: "rgba(59, 130, 246, 0.14)" },
});

export function todoHighlight() {
  let enabled = getFeature("editor.todoHighlight");
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = build(view);
        }
        update(u: ViewUpdate) {
          const now = getFeature("editor.todoHighlight");
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
