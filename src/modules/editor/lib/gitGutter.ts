// Git change markers in the editor gutter (VS Code's "dirty diff"): bars for
// added and modified lines and a wedge where lines were deleted, comparing
// the live buffer against the staged (index) version of the file. Diffing is
// debounced and skipped for very large files.

import { RangeSet, StateEffect, StateField, type EditorState } from "@codemirror/state";
import { EditorView, gutter, GutterMarker, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { native } from "@/modules/ai/lib/native";
import { getFeature } from "@/modules/settings/useFeature";
import { hunkStarts, lineChanges, type ChangeKind, type LineChange } from "./textTools/lineChanges";

const MAX_LINES = 20_000;

class ChangeMarker extends GutterMarker {
  constructor(readonly kind: ChangeKind) {
    super();
  }
  eq(o: ChangeMarker) {
    return o.kind === this.kind;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = `cm-git-${this.kind}`;
    el.title = this.kind === "deleted" ? "Lines deleted here" : this.kind === "added" ? "Added line" : "Modified line";
    return el;
  }
}
const MARKERS: Record<ChangeKind, ChangeMarker> = {
  added: new ChangeMarker("added"),
  modified: new ChangeMarker("modified"),
  deleted: new ChangeMarker("deleted"),
};

const setBase = StateEffect.define<string | null>();
const setChanges = StateEffect.define<LineChange[]>();

const baseField = StateField.define<string | null>({
  create: () => null,
  update: (v, tr) => {
    for (const e of tr.effects) if (e.is(setBase)) return e.value;
    return v;
  },
});

const changesField = StateField.define<{ changes: LineChange[]; markers: RangeSet<GutterMarker> }>({
  create: () => ({ changes: [], markers: RangeSet.empty }),
  update(v, tr) {
    let next = v;
    if (tr.docChanged) next = { changes: v.changes, markers: v.markers.map(tr.changes) };
    for (const e of tr.effects) {
      if (e.is(setChanges)) {
        const doc = tr.state.doc;
        const ranges = e.value
          .filter((c) => c.line >= 1 && c.line <= doc.lines)
          .map((c) => MARKERS[c.kind].range(doc.line(c.line).from));
        next = { changes: e.value, markers: RangeSet.of(ranges, true) };
      }
    }
    return next;
  },
});

function compute(state: EditorState): LineChange[] {
  const base = state.field(baseField);
  if (base === null || state.doc.lines > MAX_LINES || !getFeature("editor.gitGutter")) return [];
  return lineChanges(base, state.doc.toString());
}

async function loadBase(path: string): Promise<string | null> {
  const dir = path.replace(/[\\/][^\\/]*$/, "");
  const repo = await native.gitResolveRepo(dir).catch(() => null);
  if (!repo) return null;
  const root = repo.repoRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const rel = path.replace(/\\/g, "/").slice(root.length + 1);
  try {
    const res = await native.gitDiffContent(repo.repoRoot, rel, false);
    return res.isBinary ? null : res.originalContent;
  } catch {
    return null; // untracked, or not readable from the index
  }
}

export function gitGutter(getPath: () => string | null) {
  return [
    baseField,
    changesField,
    gutter({
      class: "cm-git-gutter",
      markers: (v) => v.state.field(changesField).markers,
    }),
    ViewPlugin.fromClass(
      class {
        timer: ReturnType<typeof setTimeout> | null = null;
        loading = false;
        onFocus = () => void this.reload();
        constructor(readonly view: EditorView) {
          view.contentDOM.addEventListener("focus", this.onFocus);
          void this.reload();
        }
        async reload() {
          const path = getPath();
          if (!path || this.loading) return;
          this.loading = true;
          try {
            const base = await loadBase(path);
            if (!this.view.dom.isConnected) return;
            this.view.dispatch({ effects: setBase.of(base) });
            this.schedule(0);
          } finally {
            this.loading = false;
          }
        }
        schedule(ms: number) {
          if (this.timer) clearTimeout(this.timer);
          this.timer = setTimeout(() => {
            this.timer = null;
            if (!this.view.dom.isConnected) return;
            this.view.dispatch({ effects: setChanges.of(compute(this.view.state)) });
          }, ms);
        }
        update(u: ViewUpdate) {
          if (u.docChanged) this.schedule(300);
        }
        destroy() {
          if (this.timer) clearTimeout(this.timer);
          this.view.contentDOM.removeEventListener("focus", this.onFocus);
        }
      },
    ),
    EditorView.baseTheme({
      ".cm-git-gutter": { width: "4px" },
      ".cm-git-gutter .cm-gutterElement": { padding: "0" },
      ".cm-git-added": { height: "100%", borderLeft: "3px solid #22c55e" },
      ".cm-git-modified": { height: "100%", borderLeft: "3px solid #3b82f6" },
      ".cm-git-deleted": {
        width: "0",
        height: "0",
        borderTop: "4px solid transparent",
        borderBottom: "4px solid transparent",
        borderLeft: "5px solid #ef4444",
        marginTop: "-4px",
      },
    }),
  ];
}

/** Jump to the next/previous changed hunk, wrapping. */
export function gotoChange(view: EditorView, dir: 1 | -1): boolean {
  const starts = hunkStarts(view.state.field(changesField, false)?.changes ?? []);
  if (starts.length === 0) return false;
  const cur = view.state.doc.lineAt(view.state.selection.main.head).number;
  const target =
    dir > 0 ? (starts.find((l) => l > cur) ?? starts[0]) : ([...starts].reverse().find((l) => l < cur) ?? starts[starts.length - 1]);
  const pos = view.state.doc.line(Math.min(target, view.state.doc.lines)).from;
  view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
  return true;
}
