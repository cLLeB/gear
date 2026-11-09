// LSP inlay hints: inline parameter names and inferred types the language
// server reports for the visible part of the document.

import { type Extension, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { getFeature } from "@/modules/settings/useFeature";
import type { GearLspClient, LspInlayHint } from "./client";

const DEBOUNCE_MS = 350;
const NOT_READY_RETRY_MS = 1000;
const MAX_LABEL = 60;
// Servers answer with nothing while they index (rust-analyzer can take a while),
// so an empty first answer is retried with backoff until one has hints.
const EMPTY_RETRY_MS = [1000, 2000, 4000, 8000, 15000, 30000];

export interface InlayMark {
  pos: number;
  text: string;
  kind: "type" | "parameter" | "other";
}

function labelText(label: LspInlayHint["label"]): string {
  const raw = typeof label === "string" ? label : label.map((p) => p.value).join("");
  const flat = raw.replace(/\s+/g, " ").trim();
  return flat.length > MAX_LABEL ? `${flat.slice(0, MAX_LABEL - 1)}…` : flat;
}

/** Resolve hints against a document, dropping ones outside it; sorted by position. */
export function hintsToMarks(doc: Text, hints: readonly LspInlayHint[]): InlayMark[] {
  const marks: InlayMark[] = [];
  for (const h of hints) {
    const { line, character } = h.position;
    if (line < 0 || line >= doc.lines) continue;
    const l = doc.line(line + 1);
    if (character > l.length) continue;
    const text = labelText(h.label);
    // rust-analyzer labels types it could not infer {unknown}; that says nothing.
    if (!text || text.includes("{unknown}")) continue;
    marks.push({
      pos: l.from + character,
      text: `${h.paddingLeft ? " " : ""}${text}${h.paddingRight ? " " : ""}`,
      kind: h.kind === 1 ? "type" : h.kind === 2 ? "parameter" : "other",
    });
  }
  return marks.sort((a, b) => a.pos - b.pos);
}

class HintWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly kind: InlayMark["kind"],
  ) {
    super();
  }
  eq(other: HintWidget) {
    return other.text === this.text && other.kind === this.kind;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = `cm-inlay-hint cm-inlay-${this.kind}`;
    el.textContent = this.text;
    return el;
  }
}

function toDecorations(marks: readonly InlayMark[]): DecorationSet {
  return Decoration.set(
    marks.map((m) => Decoration.widget({ widget: new HintWidget(m.text, m.kind), side: 1 }).range(m.pos)),
    true,
  );
}

const theme = EditorView.baseTheme({
  ".cm-inlay-hint": {
    fontSize: "0.88em",
    borderRadius: "4px",
    padding: "0 3px",
    margin: "0 1px",
    color: "#7b7f8b",
    backgroundColor: "rgba(127, 127, 140, 0.13)",
    verticalAlign: "baseline",
    userSelect: "none",
  },
  "&dark .cm-inlay-hint": { color: "#9a9eaa", backgroundColor: "rgba(160, 160, 175, 0.12)" },
});

export function lspInlayHints(opts: { client: GearLspClient; documentUri: string }): Extension {
  const { client, documentUri } = opts;
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet = Decoration.none;
        private timer: ReturnType<typeof setTimeout> | null = null;
        private enabled = getFeature("editor.inlayHints");
        private seq = 0;
        private emptyRetries = 0;
        private gotHints = false;
        private destroyed = false;
        private unsubscribe: () => void;

        constructor(readonly view: EditorView) {
          // Plugins only see the setting during an update; poke one on toggle.
          this.unsubscribe = usePreferencesStore.subscribe(() => {
            if (getFeature("editor.inlayHints") !== this.enabled) queueMicrotask(() => view.dispatch({}));
          });
          this.schedule(0);
        }

        update(u: ViewUpdate) {
          const now = getFeature("editor.inlayHints");
          if (now !== this.enabled) {
            this.enabled = now;
            if (!now) this.decorations = Decoration.none;
            this.schedule(0);
            return;
          }
          if (u.docChanged) this.decorations = this.decorations.map(u.changes);
          if (u.docChanged || u.viewportChanged) this.schedule(DEBOUNCE_MS);
        }

        schedule(delay: number) {
          if (this.timer) clearTimeout(this.timer);
          this.timer = setTimeout(() => void this.fetch(), delay);
        }

        async fetch() {
          this.timer = null;
          if (this.destroyed || !this.enabled) return;
          if (!client.ready) {
            this.schedule(NOT_READY_RETRY_MS);
            return;
          }
          if (!client.capabilities?.inlayHintProvider) return;
          const { view } = this;
          const doc = view.state.doc;
          const { from, to } = view.viewport;
          const start = doc.lineAt(from);
          const end = doc.lineAt(to);
          const seq = ++this.seq;
          let hints: LspInlayHint[] | null;
          try {
            hints = await client.textDocumentInlayHint({
              textDocument: { uri: documentUri },
              range: {
                start: { line: start.number - 1, character: 0 },
                end: { line: end.number - 1, character: end.length },
              },
            });
          } catch {
            return;
          }
          // A newer request or an edit made this answer stale; the next one follows.
          if (this.destroyed || seq !== this.seq || view.state.doc !== doc || !this.enabled) return;
          const marks = hintsToMarks(doc, hints ?? []);
          if (marks.length) this.gotHints = true;
          else if (!this.gotHints && this.emptyRetries < EMPTY_RETRY_MS.length) this.schedule(EMPTY_RETRY_MS[this.emptyRetries++]);
          this.decorations = toDecorations(marks);
          view.dispatch({});
        }

        destroy() {
          this.destroyed = true;
          this.unsubscribe();
          if (this.timer) clearTimeout(this.timer);
        }
      },
      { decorations: (v) => v.decorations },
    ),
    theme,
  ];
}
