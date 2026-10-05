// Editor integration for the test explorer: run / status markers beside each
// discovered test (click to run, right-click for debug), failure messages on
// the failing line, and coverage bars when coverage is shown.

import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, gutter, GutterMarker, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { quickPick } from "@/modules/quick-pick";
import { discover, frameworkFor, type TestNode } from "./model";
import { debugTest, rediscoverFile, resultKey, runTests, useTestingStore, type TestFile, type TestState } from "./store";

interface Snap {
  file: TestFile | null;
  marks: { line: number; test: TestNode; state: TestState | undefined }[];
  failures: { line: number; text: string }[];
  coverage: Record<number, number> | null;
}

const setSnap = StateEffect.define<Snap>();
const EMPTY: Snap = { file: null, marks: [], failures: [], coverage: null };
const snapField = StateField.define<Snap>({
  create: () => EMPTY,
  update: (v, tr) => {
    for (const e of tr.effects) if (e.is(setSnap)) return e.value;
    return v;
  },
});

class TestMarker extends GutterMarker {
  constructor(
    readonly test: TestNode,
    readonly state: TestState | undefined,
  ) {
    super();
  }
  eq(o: TestMarker) {
    return o.test.id === this.test.id && o.state?.status === this.state?.status;
  }
  toDOM() {
    const el = document.createElement("div");
    const s = this.state?.status;
    el.className = `cm-test-mark cm-test-${s ?? "idle"}`;
    el.textContent = s === "passed" ? "✓" : s === "failed" ? "✗" : s === "running" ? "◌" : s === "skipped" ? "○" : "▶";
    el.title = `${this.test.kind === "suite" ? "Suite" : "Test"}: ${this.test.id}\n${s ? `${s}${this.state?.durationMs !== undefined ? ` in ${this.state.durationMs} ms` : ""}\n` : ""}Click to run · right-click for more`;
    return el;
  }
}

class FailureWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(o: FailureWidget) {
    return o.text === this.text;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-test-failure";
    s.textContent = this.text;
    return s;
  }
}

const coveredLine = Decoration.line({ class: "cm-cov-hit" });
const missedLine = Decoration.line({ class: "cm-cov-miss" });

function lineDecos(state: EditorState): DecorationSet {
  const snap = state.field(snapField);
  const doc = state.doc;
  const items: { pos: number; d: Decoration }[] = [];
  if (snap.coverage) {
    for (const [ln, hits] of Object.entries(snap.coverage)) {
      const n = Number(ln);
      if (n >= 1 && n <= doc.lines) items.push({ pos: doc.line(n).from, d: hits > 0 ? coveredLine : missedLine });
    }
  }
  for (const f of snap.failures) if (f.line >= 1 && f.line <= doc.lines) items.push({ pos: doc.line(f.line).to, d: Decoration.widget({ widget: new FailureWidget(f.text), side: 1 }) });
  items.sort((a, b) => a.pos - b.pos);
  const b = new RangeSetBuilder<Decoration>();
  for (const i of items) b.add(i.pos, i.pos, i.d);
  return b.finish();
}

function firstLine(msg: string | undefined): string {
  const line = (msg ?? "").split("\n").map((l) => l.trim()).find((l) => l && !/^(at |Traceback|File |self =|def |>)/.test(l)) ?? "failed";
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

async function menu(file: TestFile, test: TestNode): Promise<void> {
  const pick = await quickPick(
    [
      { label: `Run ${test.kind === "suite" ? "suite" : "test"}`, value: "run" },
      { label: `Debug ${test.kind === "suite" ? "suite" : "test"}`, value: "debug" },
      { label: "Run file", value: "file" },
      { label: "Run file with coverage", value: "coverage" },
    ],
    { title: test.id },
  );
  if (pick === "run") void runTests({ file, test });
  else if (pick === "debug") void debugTest(file, test);
  else if (pick === "file") void runTests({ file });
  else if (pick === "coverage") void runTests({ file, coverage: true });
}

/** Test markers, failure messages and coverage for the file at `getPath()`. */
export function testGutter(getPath: () => string): Extension {
  const path = () => getPath().replace(/\\/g, "/");
  const plugin = ViewPlugin.fromClass(
    class {
      off: () => void;
      timer: ReturnType<typeof setTimeout> | null = null;
      constructor(readonly view: EditorView) {
        this.off = useTestingStore.subscribe(() => this.refresh());
        queueMicrotask(() => {
          // Files opened before discovery ran still get markers.
          const p = path();
          if (p && frameworkFor(p) && !useTestingStore.getState().files.some((f) => f.path === p) && discover(frameworkFor(p)!, view.state.doc.toString()).length) rediscoverFile(p, view.state.doc.toString());
          this.refresh();
        });
      }
      refresh() {
        const p = path();
        if (!p) return;
        const s = useTestingStore.getState();
        const file = s.files.find((f) => f.path === p) ?? null;
        const marks = file ? file.tests.map((t) => ({ line: t.line, test: t, state: s.results[resultKey(p, t.id)] })) : [];
        const failures = marks
          .filter((m) => m.state?.status === "failed" && m.test.kind === "test")
          .map((m) => ({ line: m.state?.failureLine ?? m.line, text: `✗ ${firstLine(m.state?.message)}` }));
        const cov = s.showCoverage ? (s.coverage[p]?.lines ?? null) : null;
        const next: Snap = { file, marks, failures, coverage: cov };
        const prev = this.view.state.field(snapField);
        const same = prev.file === next.file && prev.coverage === next.coverage && JSON.stringify(prev.marks.map((m) => [m.line, m.test.id, m.state?.status])) === JSON.stringify(next.marks.map((m) => [m.line, m.test.id, m.state?.status])) && JSON.stringify(prev.failures) === JSON.stringify(next.failures);
        if (!same) this.view.dispatch({ effects: setSnap.of(next) });
      }
      update(u: ViewUpdate) {
        if (!u.docChanged) return;
        const p = path();
        if (!p || !frameworkFor(p)) return;
        if (this.timer) clearTimeout(this.timer);
        // Re-discover while typing so markers follow the code.
        this.timer = setTimeout(() => rediscoverFile(p, this.view.state.doc.toString()), 700);
      }
      destroy() {
        this.off();
        if (this.timer) clearTimeout(this.timer);
      }
    },
  );
  return [
    snapField,
    plugin,
    EditorView.decorations.compute([snapField, "doc"], lineDecos),
    gutter({
      class: "cm-test-gutter",
      markers: (view) => {
        const snap = view.state.field(snapField);
        const doc = view.state.doc;
        const b = new RangeSetBuilder<GutterMarker>();
        const seen = new Set<number>();
        for (const m of [...snap.marks].sort((a, c) => a.line - c.line)) {
          if (m.line < 1 || m.line > doc.lines || seen.has(m.line)) continue;
          seen.add(m.line);
          b.add(doc.line(m.line).from, doc.line(m.line).from, new TestMarker(m.test, m.state));
        }
        return b.finish();
      },
      lineMarkerChange: (u) => u.transactions.some((t) => t.effects.some((e) => e.is(setSnap))),
      domEventHandlers: {
        mousedown: (view, block, event) => {
          if ((event as MouseEvent).button !== 0) return false;
          const snap = view.state.field(snapField);
          const line = view.state.doc.lineAt(block.from).number;
          const m = snap.marks.find((x) => x.line === line);
          if (!m || !snap.file) return false;
          void runTests({ file: snap.file, test: m.test });
          return true;
        },
        contextmenu: (view, block, event) => {
          const snap = view.state.field(snapField);
          const m = snap.marks.find((x) => x.line === view.state.doc.lineAt(block.from).number);
          if (!m || !snap.file) return false;
          event.preventDefault();
          void menu(snap.file, m.test);
          return true;
        },
      },
    }),
    EditorView.baseTheme({
      ".cm-test-gutter": { width: "16px" },
      ".cm-test-mark": { cursor: "pointer", fontSize: "10px", textAlign: "center", lineHeight: "inherit", opacity: "0.85" },
      ".cm-test-idle": { color: "#22a06b", opacity: "0.5" },
      ".cm-test-idle:hover": { opacity: "1" },
      ".cm-test-passed": { color: "#22a06b", fontWeight: "700" },
      ".cm-test-failed": { color: "#e5484d", fontWeight: "700" },
      ".cm-test-running": { color: "#f5a524", animation: "cm-test-spin 1s linear infinite" },
      ".cm-test-skipped": { color: "#8b8d98" },
      "@keyframes cm-test-spin": { from: { transform: "rotate(0deg)" }, to: { transform: "rotate(360deg)" } },
      ".cm-test-failure": { marginLeft: "2em", color: "#e5484d", fontStyle: "italic", fontSize: "0.9em", whiteSpace: "pre" },
      ".cm-cov-hit": { boxShadow: "inset 3px 0 0 rgba(34, 160, 107, 0.65)" },
      ".cm-cov-miss": { boxShadow: "inset 3px 0 0 rgba(229, 72, 77, 0.7)", backgroundColor: "rgba(229, 72, 77, 0.06)" },
    }),
  ];
}
