// Minimap: a zoomed-out strip of the file on the right edge of the editor,
// with a slider over the visible part. Click or drag to scroll. Drawn on a
// canvas from line shapes only (no highlighting), so it stays cheap on any
// file size: only the rows that fit the strip are ever read.

import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { getFeature } from "@/modules/settings/useFeature";

export const MINIMAP_WIDTH = 84;
const ROW_PX = 3;
const INK_PX = 2;
const MAX_COLS = 120;
const MIN_EDITOR_WIDTH = 520;

/** Column runs of visible ink in a line: [start, end) pairs, tabs expanded. */
export function inkRuns(text: string, tabSize: number, maxCols = MAX_COLS): number[] {
  const out: number[] = [];
  let col = 0;
  let start = -1;
  for (let i = 0; i < text.length && col < maxCols; i++) {
    const ch = text.charCodeAt(i);
    const blank = ch === 32 || ch === 9;
    if (blank && start >= 0) {
      out.push(start, col);
      start = -1;
    } else if (!blank && start < 0) start = col;
    col += ch === 9 ? tabSize - (col % tabSize) : 1;
  }
  if (start >= 0) out.push(start, Math.min(col, maxCols));
  return out;
}

export interface MinimapLayout {
  /** First document line drawn (1-based). */
  start: number;
  /** How many lines the strip shows. */
  rows: number;
  sliderTop: number;
  sliderHeight: number;
  /** Height in px actually covered by lines. */
  inkHeight: number;
}

/**
 * A file shorter than the strip is drawn from the top; a longer one scrolls
 * through the strip in proportion to the editor's own scroll position, so the
 * slider travels the full height exactly as the editor travels the file.
 */
export function minimapLayout(totalLines: number, height: number, firstVisible: number, lastVisible: number, scrollRatio: number, rowPx = ROW_PX): MinimapLayout {
  const capacity = Math.max(1, Math.floor(height / rowPx));
  const rows = Math.min(totalLines, capacity);
  const ratio = Math.min(1, Math.max(0, scrollRatio));
  const start = totalLines <= capacity ? 1 : 1 + Math.round(ratio * (totalLines - capacity));
  const inkHeight = rows * rowPx;
  const sliderHeight = Math.min(inkHeight, Math.max(rowPx * 4, (lastVisible - firstVisible + 1) * rowPx));
  const sliderTop = Math.min(inkHeight - sliderHeight, Math.max(0, (firstVisible - start) * rowPx));
  return { start, rows, sliderTop, sliderHeight, inkHeight };
}

/** The document line under a y offset in the strip. */
export function lineAtY(y: number, layout: MinimapLayout, rowPx = ROW_PX): number {
  const row = Math.min(layout.rows - 1, Math.max(0, Math.floor(y / rowPx)));
  return layout.start + row;
}

/** Scroll ratio (0..1) that puts the slider's top at `top`. */
export function ratioForSliderTop(top: number, layout: MinimapLayout): number {
  const travel = layout.inkHeight - layout.sliderHeight;
  return travel <= 0 ? 0 : Math.min(1, Math.max(0, top / travel));
}

class MinimapPlugin {
  private dom: HTMLElement;
  private canvas: HTMLCanvasElement;
  private slider: HTMLElement;
  private raf = 0;
  private layout: MinimapLayout | null = null;
  private shown = false;
  private unsubscribe: () => void;
  private resize: ResizeObserver;

  private schedule = () => {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.render());
  };

  constructor(readonly view: EditorView) {
    this.dom = document.createElement("div");
    this.dom.className = "cm-minimap";
    this.dom.setAttribute("aria-hidden", "true");
    this.canvas = document.createElement("canvas");
    this.slider = document.createElement("div");
    this.slider.className = "cm-minimap-slider";
    this.dom.append(this.canvas, this.slider);
    view.dom.appendChild(this.dom);
    this.dom.addEventListener("pointerdown", this.onPointerDown);
    this.dom.addEventListener("wheel", this.onWheel, { passive: true });
    view.scrollDOM.addEventListener("scroll", this.schedule, { passive: true });
    this.resize = new ResizeObserver(this.schedule);
    this.resize.observe(view.dom);
    let enabled = getFeature("editor.minimap");
    this.unsubscribe = usePreferencesStore.subscribe(() => {
      const now = getFeature("editor.minimap");
      if (now !== enabled) {
        enabled = now;
        this.schedule();
      }
    });
    this.schedule();
  }

  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || u.geometryChanged || u.selectionSet) this.schedule();
  }

  private scrollRange(): number {
    const s = this.view.scrollDOM;
    return Math.max(0, s.scrollHeight - s.clientHeight);
  }

  private setShown(on: boolean) {
    if (on === this.shown) return;
    this.shown = on;
    this.dom.style.display = on ? "" : "none";
    this.view.dom.classList.toggle("cm-has-minimap", on);
  }

  private render() {
    const view = this.view;
    const on = getFeature("editor.minimap") && view.dom.clientWidth >= MIN_EDITOR_WIDTH;
    this.setShown(on);
    if (!on) return;
    const s = view.scrollDOM;
    const height = this.dom.clientHeight;
    if (height <= 0) return;
    const doc = view.state.doc;
    const lineOf = (y: number) => doc.lineAt(view.lineBlockAtHeight(y).from).number;
    const first = lineOf(s.scrollTop);
    const last = lineOf(s.scrollTop + s.clientHeight);
    const range = this.scrollRange();
    const layout = minimapLayout(doc.lines, height, first, last, range ? s.scrollTop / range : 0);
    this.layout = layout;

    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(MINIMAP_WIDTH * dpr);
    const h = Math.round(height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.canvas.style.width = `${MINIMAP_WIDTH}px`;
      this.canvas.style.height = `${height}px`;
    }
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, MINIMAP_WIDTH, height);

    const style = getComputedStyle(view.contentDOM);
    const tab = view.state.tabSize;
    const colPx = (MINIMAP_WIDTH - 8) / MAX_COLS;
    // Selected lines get a band behind the ink; the cursor line a marker.
    const sel = view.state.selection;
    ctx.fillStyle = style.color;
    ctx.globalAlpha = 0.14;
    for (const r of sel.ranges) {
      if (r.empty) continue;
      const a = Math.max(doc.lineAt(r.from).number, layout.start);
      const b = Math.min(doc.lineAt(r.to).number, layout.start + layout.rows - 1);
      if (b >= a) ctx.fillRect(0, (a - layout.start) * ROW_PX, MINIMAP_WIDTH, (b - a + 1) * ROW_PX);
    }
    ctx.globalAlpha = 0.5;
    const end = layout.start + layout.rows - 1;
    for (let n = layout.start; n <= end; n++) {
      const runs = inkRuns(doc.line(n).text, tab);
      const y = (n - layout.start) * ROW_PX;
      for (let i = 0; i < runs.length; i += 2) ctx.fillRect(4 + runs[i] * colPx, y, Math.max(1, (runs[i + 1] - runs[i]) * colPx), INK_PX);
    }
    const cursor = doc.lineAt(sel.main.head).number;
    if (cursor >= layout.start && cursor <= end) {
      ctx.globalAlpha = 0.9;
      ctx.fillRect(0, (cursor - layout.start) * ROW_PX, 2, ROW_PX);
    }
    ctx.globalAlpha = 1;

    this.slider.style.top = `${layout.sliderTop}px`;
    this.slider.style.height = `${layout.sliderHeight}px`;
  }

  private onWheel = (e: WheelEvent) => {
    this.view.scrollDOM.scrollTop += e.deltaY;
  };

  private onPointerDown = (e: PointerEvent) => {
    const layout = this.layout;
    if (e.button !== 0 || !layout) return;
    e.preventDefault();
    const view = this.view;
    const top = this.dom.getBoundingClientRect().top;
    let y = e.clientY - top;
    const onSlider = y >= layout.sliderTop && y <= layout.sliderTop + layout.sliderHeight;
    if (!onSlider) {
      // Centre the clicked line, then keep dragging from the slider's middle.
      const line = view.state.doc.line(lineAtY(y, layout));
      view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
    }
    const grab = onSlider ? y - layout.sliderTop : layout.sliderHeight / 2;
    this.dom.setPointerCapture(e.pointerId);
    this.dom.classList.add("cm-minimap-dragging");
    const move = (m: PointerEvent) => {
      if (!this.layout) return;
      y = m.clientY - top;
      view.scrollDOM.scrollTop = ratioForSliderTop(y - grab, this.layout) * this.scrollRange();
    };
    const up = () => {
      this.dom.removeEventListener("pointermove", move);
      this.dom.removeEventListener("pointerup", up);
      this.dom.removeEventListener("pointercancel", up);
      this.dom.classList.remove("cm-minimap-dragging");
    };
    this.dom.addEventListener("pointermove", move);
    this.dom.addEventListener("pointerup", up);
    this.dom.addEventListener("pointercancel", up);
  };

  destroy() {
    cancelAnimationFrame(this.raf);
    this.unsubscribe();
    this.resize.disconnect();
    this.view.scrollDOM.removeEventListener("scroll", this.schedule);
    this.view.dom.classList.remove("cm-has-minimap");
    this.dom.remove();
  }
}

export function minimap(): Extension {
  return [
    ViewPlugin.fromClass(MinimapPlugin),
    EditorView.baseTheme({
      ".cm-minimap": {
        position: "absolute",
        top: "0",
        right: "0",
        bottom: "0",
        width: `${MINIMAP_WIDTH}px`,
        zIndex: "6",
        overflow: "hidden",
        cursor: "default",
        borderLeft: "1px solid color-mix(in srgb, currentColor 10%, transparent)",
      },
      ".cm-minimap canvas": { display: "block" },
      ".cm-minimap-slider": {
        position: "absolute",
        left: "0",
        right: "0",
        backgroundColor: "color-mix(in srgb, currentColor 10%, transparent)",
        pointerEvents: "none",
      },
      ".cm-minimap:hover .cm-minimap-slider, .cm-minimap-dragging .cm-minimap-slider": {
        backgroundColor: "color-mix(in srgb, currentColor 18%, transparent)",
      },
      "&.cm-has-minimap .cm-scroller": { marginRight: `${MINIMAP_WIDTH}px` },
      "&.cm-has-minimap .cm-sticky": { right: `${MINIMAP_WIDTH}px` },
    }),
  ];
}
