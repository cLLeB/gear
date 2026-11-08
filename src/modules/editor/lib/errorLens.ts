// Error lens: print each line's most severe diagnostic message at the end of
// that line and tint the line, so problems are readable without hovering.
// Works for any diagnostics source (built-in engine or LSP) because it reads
// CodeMirror's lint state.

import { forEachDiagnostic, setDiagnosticsEffect } from "@codemirror/lint";
import { type EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { getFeature } from "@/modules/settings/useFeature";

export type LensSeverity = "error" | "warning" | "info" | "hint";

export interface LensDiagnostic {
  from: number;
  severity: LensSeverity;
  message: string;
}

export interface LineLens {
  line: number;
  severity: LensSeverity;
  message: string;
  /** Diagnostics on the line besides the one shown. */
  more: number;
}

const RANK: Record<LensSeverity, number> = { error: 3, warning: 2, info: 1, hint: 0 };
const MAX_MESSAGE = 160;

/** First line of a message, trimmed and capped so long ones don't run on. */
export function lensMessage(message: string): string {
  const first = message.trim().split(/\r?\n/, 1)[0] ?? "";
  return first.length > MAX_MESSAGE ? `${first.slice(0, MAX_MESSAGE - 1)}…` : first;
}

/** Group diagnostics by line, keeping the most severe (earliest on ties). */
export function summarizeLines(diagnostics: readonly LensDiagnostic[], lineOf: (pos: number) => number): LineLens[] {
  const byLine = new Map<number, LineLens>();
  const sorted = [...diagnostics].sort((a, b) => a.from - b.from);
  for (const d of sorted) {
    const line = lineOf(d.from);
    const prev = byLine.get(line);
    if (!prev) {
      byLine.set(line, { line, severity: d.severity, message: lensMessage(d.message), more: 0 });
    } else if (RANK[d.severity] > RANK[prev.severity]) {
      byLine.set(line, { line, severity: d.severity, message: lensMessage(d.message), more: prev.more + 1 });
    } else {
      prev.more += 1;
    }
  }
  return [...byLine.values()].sort((a, b) => a.line - b.line);
}

class LensWidget extends WidgetType {
  constructor(readonly lens: LineLens) {
    super();
  }
  eq(other: LensWidget) {
    const a = this.lens;
    const b = other.lens;
    return a.severity === b.severity && a.message === b.message && a.more === b.more;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = `cm-lens cm-lens-${this.lens.severity}`;
    el.textContent = this.lens.more > 0 ? `${this.lens.message}  (+${this.lens.more})` : this.lens.message;
    el.title = this.lens.message;
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

const lineMarks: Record<LensSeverity, Decoration> = {
  error: Decoration.line({ class: "cm-lens-line cm-lens-line-error" }),
  warning: Decoration.line({ class: "cm-lens-line cm-lens-line-warning" }),
  info: Decoration.line({ class: "cm-lens-line cm-lens-line-info" }),
  hint: Decoration.line({ class: "cm-lens-line cm-lens-line-hint" }),
};

function collect(state: EditorState): LensDiagnostic[] {
  const out: LensDiagnostic[] = [];
  forEachDiagnostic(state, (d, from) => {
    out.push({ from, severity: d.severity, message: d.message });
  });
  return out;
}

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  if (!getFeature("editor.errorLens")) return b.finish();
  const { doc } = view.state;
  const lenses = summarizeLines(collect(view.state), (pos) => doc.lineAt(Math.min(pos, doc.length)).number);
  if (!lenses.length) return b.finish();
  const visible = view.visibleRanges;
  for (const lens of lenses) {
    const line = doc.line(lens.line);
    if (!visible.some((r) => line.to >= r.from && line.from <= r.to)) continue;
    b.add(line.from, line.from, lineMarks[lens.severity]);
    b.add(line.to, line.to, Decoration.widget({ widget: new LensWidget(lens), side: 1 }));
  }
  return b.finish();
}

const theme = EditorView.baseTheme({
  ".cm-lens": {
    marginLeft: "2.5em",
    fontStyle: "italic",
    fontSize: "0.92em",
    whiteSpace: "pre",
    pointerEvents: "none",
    opacity: "0.85",
  },
  ".cm-lens-error": { color: "#e5484d" },
  ".cm-lens-warning": { color: "#d97706" },
  ".cm-lens-info": { color: "#3b82f6" },
  ".cm-lens-hint": { color: "#8b8d98" },
  ".cm-lens-line-error": { backgroundColor: "rgba(229, 72, 77, 0.08)" },
  ".cm-lens-line-warning": { backgroundColor: "rgba(217, 119, 6, 0.07)" },
  ".cm-lens-line-info": { backgroundColor: "rgba(59, 130, 246, 0.06)" },
  "&dark .cm-lens-error": { color: "#ff8589" },
  "&dark .cm-lens-warning": { color: "#f5b340" },
  "&dark .cm-lens-info": { color: "#7cb7ff" },
});

export function errorLens() {
  let enabled = getFeature("editor.errorLens");
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = build(view);
        }
        update(u: ViewUpdate) {
          const now = getFeature("editor.errorLens");
          const lintChanged = u.transactions.some((tr) => tr.effects.some((e) => e.is(setDiagnosticsEffect)));
          if (lintChanged || u.docChanged || u.viewportChanged || now !== enabled) {
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
