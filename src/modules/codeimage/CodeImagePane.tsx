// gear-codeimage://: the selected code as a picture — themed, with optional
// line numbers, window frame and backdrop — to copy or save as PNG.

import { syntaxTree } from "@codemirror/language";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { bytesToBase64, toolPaneHandle, toolsNative } from "@/modules/tools/paneHandle";
import { BACKDROPS, imageName, layout, THEMES, toLines, type Options, type Run, type Span, type Theme } from "./model";

export const CODEIMAGE_PATH = "gear-codeimage://Code image";
const FONT = 'ui-monospace, "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace';
const MAX_LINES = 400;

interface Source {
  text: string;
  spans: Span[];
  base: number;
  firstLine: number;
  path: string | null;
}

export const useCodeImage = create<{ source: Source | null }>(() => ({ source: null }));

/** Takes the selection (or the whole file when nothing is selected) from the last editor. */
export function captureFromEditor(): boolean {
  const active = getActiveEditor();
  if (!active) return false;
  const { state } = active.view;
  const sel = state.selection.main;
  const fromLine = state.doc.lineAt(sel.empty ? 0 : sel.from);
  let toLine = state.doc.lineAt(sel.empty ? state.doc.length : sel.to);
  // A selection that ends at the very start of a line does not include that line.
  if (!sel.empty && sel.to === toLine.from && toLine.number > fromLine.number) toLine = state.doc.line(toLine.number - 1);
  const last = Math.min(toLine.number, fromLine.number + MAX_LINES - 1);
  const from = fromLine.from;
  const to = state.doc.line(last).to;
  const spans: Span[] = [];
  highlightTree(syntaxTree(state), classHighlighter, (a, b, classes) => spans.push({ from: a, to: b, classes }), from, to);
  useCodeImage.setState({ source: { text: state.sliceDoc(from, to), spans, base: from, firstLine: fromLine.number, path: active.path ?? null } });
  return true;
}

export function openCodeImage(): void {
  if (!captureFromEditor()) return void toast.info("Open a file and select the code to turn into a picture.");
  app().openFile(CODEIMAGE_PATH);
}

function draw(canvas: HTMLCanvasElement, lines: Run[][], theme: Theme, backdrop: string[], o: Options, scale: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.font = `${o.fontSize}px ${FONT}`;
  const charWidth = ctx.measureText("M".repeat(20)).width / 20;
  const L = layout(lines, charWidth, o);
  canvas.width = Math.ceil(L.width * scale);
  canvas.height = Math.ceil(L.height * scale);
  canvas.style.width = `${L.width}px`;
  canvas.style.height = `${L.height}px`;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, L.width, L.height);
  if (backdrop.length && o.margin > 0) {
    const g = ctx.createLinearGradient(0, 0, L.width, L.height);
    backdrop.forEach((c, i) => g.addColorStop(backdrop.length === 1 ? 0 : i / (backdrop.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, L.width, L.height);
  }
  const { x, y, w, h } = L.window;
  const radius = o.margin > 0 ? Math.round(o.fontSize * 0.6) : 0;
  if (o.margin > 0 && backdrop.length) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
    ctx.shadowBlur = o.fontSize * 1.6;
    ctx.shadowOffsetY = o.fontSize * 0.5;
  }
  ctx.fillStyle = theme.surface;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  if (L.headerHeight) {
    const cy = y + L.headerHeight / 2;
    if (o.windowChrome) {
      const r = o.fontSize * 0.32;
      ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(x + o.fontSize * 1.2 + i * r * 3.2, cy, r, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    if (o.title) {
      ctx.fillStyle = theme.title;
      ctx.font = `${Math.round(o.fontSize * 0.82)}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(o.title, x + w / 2, cy, w - o.fontSize * 8);
    }
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  lines.forEach((runs, i) => {
    const cy = L.codeY + i * L.lineHeight + L.lineHeight / 2;
    if (o.lineNumbers) {
      ctx.font = `${o.fontSize}px ${FONT}`;
      ctx.fillStyle = theme.lineNumber;
      ctx.textAlign = "right";
      ctx.fillText(String(o.firstLine + i), L.codeX - charWidth * 1.5, cy);
      ctx.textAlign = "left";
    }
    let col = 0;
    for (const run of runs) {
      ctx.font = `${run.italic ? "italic " : ""}${run.bold ? "600 " : ""}${o.fontSize}px ${FONT}`;
      ctx.fillStyle = run.color;
      // Every character sits on the grid, so bold or italic runs cannot shift what follows.
      const chars = [...run.text];
      ctx.fillText(run.text, L.codeX + col * charWidth, cy);
      col += chars.length;
    }
  });
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";

export const CodeImagePane = forwardRef<EditorPaneHandle, { path: string }>(function CodeImagePane({ path }, ref) {
  const source = useCodeImage((s) => s.source);
  const [themeId, setThemeId] = useState("night");
  const [backdropId, setBackdropId] = useState("sea");
  const [fontSize, setFontSize] = useState(16);
  const [lineNumbers, setLineNumbers] = useState(true);
  const [windowChrome, setWindowChrome] = useState(true);
  const [showTitle, setShowTitle] = useState(true);
  const [dedent, setDedent] = useState(true);
  const [margin, setMargin] = useState(48);
  const canvas = useRef<HTMLCanvasElement>(null);

  useImperativeHandle(ref, () => toolPaneHandle(path, { reload: () => captureFromEditor() }), [path]);

  const theme = THEMES.find((t) => t.id === themeId) ?? THEMES[0];
  const backdrop = BACKDROPS.find((b) => b.id === backdropId)?.colors ?? [];
  const lines = useMemo(() => (source ? toLines(source.text, source.spans, theme, { base: source.base, dedent, tabSize: 2 }) : []), [source, theme, dedent]);
  const options: Options = useMemo(
    () => ({ fontSize, lineNumbers, firstLine: source?.firstLine ?? 1, margin: backdrop.length ? margin : 0, windowChrome, title: showTitle ? (source?.path?.split(/[\\/]/).pop() ?? "") : "" }),
    [fontSize, lineNumbers, source, margin, windowChrome, showTitle, backdrop.length],
  );

  useEffect(() => {
    if (canvas.current && source) draw(canvas.current, lines, theme, backdrop, options, 2);
  }, [lines, theme, backdrop, options, source]);

  const blob = () => new Promise<Blob | null>((res) => (canvas.current ? canvas.current.toBlob(res, "image/png") : res(null)));

  const copy = async () => {
    try {
      const b = await blob();
      if (!b) throw new Error("nothing to copy");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": b })]);
      toast.success("Image copied");
    } catch (err) {
      toast.error(`Could not copy the image: ${String(err)}`);
    }
  };

  const save = async () => {
    const root = app().workspaceRoot();
    if (!root || !source) return void toast.error("Open a folder first.");
    try {
      const b = await blob();
      if (!b) throw new Error("nothing to save");
      const name = imageName(source.path, source.firstLine, lines.length);
      await toolsNative.writeBytes(`${root.replace(/[\\/]+$/, "")}/${name}`, bytesToBase64(new Uint8Array(await b.arrayBuffer())));
      toast.success(`Saved ${name}`);
    } catch (err) {
      toast.error(`Could not save: ${String(err)}`);
    }
  };

  if (!source) return <div className="p-6 text-[12.5px] text-muted-foreground">Select code in a file, then run “Code image: Make a picture of the selected code”.</div>;

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/60 p-2">
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Theme</span>
          {THEMES.map((t) => (
            <button key={t.id} type="button" data-theme-id={t.id} className={cn(btn, themeId === t.id && "bg-muted font-medium")} onClick={() => setThemeId(t.id)}>
              {t.name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Backdrop</span>
          {BACKDROPS.map((b) => (
            <button key={b.id} type="button" data-backdrop={b.id} title={b.name} className={cn("h-5 w-5 rounded border", backdropId === b.id ? "border-primary ring-1 ring-primary" : "border-border/60")} style={{ background: b.colors.length ? `linear-gradient(135deg, ${b.colors.join(", ")})` : "transparent" }} onClick={() => setBackdropId(b.id)}>
              {b.colors.length ? "" : "∅"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1">
          Size
          <input type="range" min={11} max={26} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} />
        </label>
        <label className="flex items-center gap-1">
          Space
          <input type="range" min={16} max={96} step={8} value={margin} disabled={!backdrop.length} onChange={(e) => setMargin(Number(e.target.value))} />
        </label>
        {(
          [
            ["Line numbers", lineNumbers, setLineNumbers],
            ["Window", windowChrome, setWindowChrome],
            ["File name", showTitle, setShowTitle],
            ["Remove indent", dedent, setDedent],
          ] as [string, boolean, (v: boolean) => void][]
        ).map(([label, value, set]) => (
          <label key={label} className="flex items-center gap-1">
            <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} />
            {label}
          </label>
        ))}
        <span className="flex-1" />
        <button type="button" className={btn} title="Take the current selection again" onClick={() => captureFromEditor() || toast.info("Open a file first.")}>
          Retake
        </button>
        <button type="button" className={cn(btn, "bg-primary/10")} onClick={() => void copy()}>
          Copy image
        </button>
        <button type="button" className={btn} onClick={() => void save()}>
          Save PNG
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4">
        <canvas ref={canvas} data-code-canvas data-lines={lines.length} className="mx-auto block max-w-none shadow-sm" />
      </div>
      <div className="border-t border-border/60 px-2 py-1 text-muted-foreground">
        {lines.length} lines{source.path ? ` from ${source.path.split(/[\\/]/).pop()}` : ""}, starting at line {source.firstLine}. The picture is saved at twice this size so it stays sharp.
      </div>
    </div>
  );
});

export const CODEIMAGE_ACTIONS = [{ id: "codeimage.open", label: "Code image: Make a picture of the selected code", keywords: ["image", "screenshot", "picture", "png", "share", "carbon", "snippet", "export", "code"], run: openCodeImage }];
