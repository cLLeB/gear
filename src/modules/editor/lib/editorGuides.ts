// Visual guides: vertical rulers at configured columns (VS Code's
// editor.rulers), whitespace rendering and trailing-whitespace highlighting.
// All are driven by feature settings and reconfigure live.

import { Compartment, type Extension } from "@codemirror/state";
import { EditorView, highlightTrailingWhitespace, highlightWhitespace, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { getFeature } from "@/modules/settings/useFeature";
import { usePreferencesStore } from "@/modules/settings/preferences";

/** "80, 120" → [80, 120]; invalid entries are dropped, duplicates removed. */
export function parseRulers(spec: string): number[] {
  return [
    ...new Set(
      spec
        .split(/[\s,;]+/)
        .map((s) => Number.parseInt(s, 10))
        .filter((n) => Number.isFinite(n) && n > 0 && n <= 1000),
    ),
  ].sort((a, b) => a - b);
}

const rulerPlugin = (columns: number[]) =>
  ViewPlugin.fromClass(
    class {
      dom: HTMLElement;
      constructor(readonly view: EditorView) {
        this.dom = document.createElement("div");
        this.dom.className = "cm-rulers";
        this.dom.setAttribute("aria-hidden", "true");
        view.scrollDOM.appendChild(this.dom);
        this.draw();
      }
      update(u: ViewUpdate) {
        if (u.geometryChanged || u.viewportChanged) this.draw();
      }
      draw() {
        const charW = this.view.defaultCharacterWidth;
        const line = this.view.contentDOM.querySelector(".cm-line") as HTMLElement | null;
        const pad = line ? Number.parseFloat(getComputedStyle(line).paddingLeft) || 0 : 0;
        const base = this.view.contentDOM.offsetLeft + pad;
        this.dom.replaceChildren(
          ...columns.map((c) => {
            const r = document.createElement("div");
            r.className = "cm-ruler";
            r.style.left = `${base + c * charW}px`;
            return r;
          }),
        );
        this.dom.style.height = `${Math.max(this.view.contentHeight, this.view.scrollDOM.clientHeight)}px`;
      }
      destroy() {
        this.dom.remove();
      }
    },
  );

const guidesTheme = EditorView.baseTheme({
  ".cm-scroller": { position: "relative" },
  ".cm-rulers": { position: "absolute", top: "0", left: "0", pointerEvents: "none", zIndex: "0" },
  ".cm-ruler": {
    position: "absolute",
    top: "0",
    bottom: "0",
    width: "0",
    borderLeft: "1px solid color-mix(in srgb, currentColor 14%, transparent)",
  },
  ".cm-trailingSpace": { backgroundColor: "rgba(239, 68, 68, 0.22)" },
});

function current(): Extension[] {
  const out: Extension[] = [guidesTheme];
  const rulers = parseRulers(getFeature("editor.rulers"));
  if (rulers.length > 0) out.push(rulerPlugin(rulers));
  if (getFeature("editor.renderWhitespace")) out.push(highlightWhitespace());
  if (getFeature("editor.highlightTrailingWhitespace")) out.push(highlightTrailingWhitespace());
  return out;
}

/** Guides extension that follows the feature settings while the editor lives. */
export function editorGuides(): Extension {
  const compartment = new Compartment();
  let lastKey = "";
  const key = () =>
    `${getFeature("editor.rulers")}|${getFeature("editor.renderWhitespace")}|${getFeature("editor.highlightTrailingWhitespace")}`;
  return [
    compartment.of(current()),
    ViewPlugin.fromClass(
      class {
        unsub: () => void;
        constructor(view: EditorView) {
          lastKey = key();
          this.unsub = usePreferencesStore.subscribe(() => {
            const k = key();
            if (k === lastKey) return;
            lastKey = k;
            view.dispatch({ effects: compartment.reconfigure(current()) });
          });
        }
        destroy() {
          this.unsub();
        }
      },
    ),
  ];
}
