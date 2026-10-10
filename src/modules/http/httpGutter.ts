// .http / .rest editors: a "▶" gutter marker on every request line (click to
// send; shows the last status once answered) and Mod-Enter / Ctrl-Alt-R to send
// the request under the cursor.

import { Prec, RangeSetBuilder, StateEffect, type Extension } from "@codemirror/state";
import { EditorView, gutter, GutterMarker, keymap, ViewPlugin } from "@codemirror/view";
import { parseHttpFile } from "./model";
import { isHttpFile, requestKey, sendAt, useHttpStore } from "./store";

const refresh = StateEffect.define<null>();

class SendMarker extends GutterMarker {
  constructor(readonly status: number | null, readonly error: boolean, readonly running: boolean) {
    super();
  }
  eq(o: SendMarker) {
    return o.status === this.status && o.error === this.error && o.running === this.running;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-http-send";
    el.textContent = this.running ? "…" : this.status ? String(this.status) : this.error ? "✗" : "▶";
    el.title = this.running ? "Sending…" : "Send request (Mod-Enter)";
    el.style.cssText = `cursor:pointer;font-size:10px;font-weight:600;padding:0 3px;border-radius:3px;color:${this.error || (this.status ?? 0) >= 400 ? "#ef4444" : this.status ? "#22c55e" : "#3b82f6"}`;
    return el;
  }
}

export function httpGutter(getPath: () => string): Extension {
  const path = () => getPath().replace(/\\/g, "/");
  // Editors are created per file; other files get no gutter column at all.
  if (!isHttpFile(path())) return [];
  const send = (view: EditorView, line: number) => {
    void sendAt(path(), view.state.doc.toString(), line);
    window.dispatchEvent(new CustomEvent("gear:http-panel", { detail: { path: path() } }));
    return true;
  };
  const plugin = ViewPlugin.fromClass(
    class {
      off: () => void;
      constructor(view: EditorView) {
        this.off = useHttpStore.subscribe(() => queueMicrotask(() => view.dispatch({ effects: refresh.of(null) })));
      }
      destroy() {
        this.off();
      }
    },
  );
  return [
    plugin,
    gutter({
      class: "cm-http-gutter",
      markers: (view) => {
        const b = new RangeSetBuilder<GutterMarker>();
        if (!isHttpFile(path())) return b.finish();
        const file = parseHttpFile(view.state.doc.toString());
        const st = useHttpStore.getState();
        const hist = st.history[path()] ?? [];
        for (const r of file.requests) {
          if (r.line + 1 > view.state.doc.lines) continue;
          const last = hist.find((h) => h.key === requestKey(r));
          const pos = view.state.doc.line(r.line + 1).from;
          b.add(pos, pos, new SendMarker(last && !last.error ? last.status : null, Boolean(last?.error), false));
        }
        return b.finish();
      },
      lineMarkerChange: (u) => u.docChanged || u.transactions.some((t) => t.effects.some((e) => e.is(refresh))),
      domEventHandlers: {
        mousedown: (view, block) => {
          const line = view.state.doc.lineAt(block.from).number - 1;
          if (!parseHttpFile(view.state.doc.toString()).requests.some((r) => r.line === line)) return false;
          return send(view, line);
        },
      },
    }),
    Prec.high(
      keymap.of(
        ["Mod-Enter", "Ctrl-Alt-r"].map((key) => ({
          key,
          run: (view: EditorView) => (isHttpFile(path()) ? send(view, view.state.doc.lineAt(view.state.selection.main.head).number - 1) : false),
        })),
      ),
    ),
  ];
}
