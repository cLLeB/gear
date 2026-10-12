// gear-slides://<file>: present a Markdown file as slides, with speaker
// notes, an overview and a clock.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import { app, frontFilePath } from "@/app/appBridge";
import { MarkdownCode } from "@/components/ai-elements/markdown-code";
import { cn, isMarkdownPath } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { MarkdownLink } from "@/modules/markdown/MarkdownLink";
import { inputBox } from "@/modules/quick-pick";
import { toolPaneHandle } from "@/modules/tools/paneHandle";
import { clampIndex, fitScale, formatElapsed, navigate, parseDeck, SAMPLE_DECK, speakingSeconds, type Deck } from "./model";

const SCHEME = "gear-slides://";
const components = { a: MarkdownLink, code: MarkdownCode };

export function openSlidesFor(file: string): void {
  app().openFile(`${SCHEME}${file}`);
}

export function openSlidesForActive(): void {
  const file = frontFilePath() ?? getActiveEditor()?.path ?? null;
  if (!file || !isMarkdownPath(file)) return void toast.info("Open a Markdown file first — a line of three dashes starts a new slide.");
  openSlidesFor(file);
}

export async function newDeck(): Promise<void> {
  const root = app().workspaceRoot();
  if (!root) return void toast.error("Open a folder first.");
  const name = (await inputBox({ title: "New slide deck", value: "slides.md", placeholder: "File name" }))?.trim();
  if (!name) return;
  const file = `${root.replace(/[\\/]+$/, "")}/${/\.(md|markdown)$/i.test(name) ? name : `${name}.md`}`;
  if (!(await native.readFile(file).catch(() => null))) {
    try {
      await native.writeFile(file, SAMPLE_DECK, "user");
    } catch (err) {
      return void toast.error(`Could not create ${name}: ${String(err)}`);
    }
  }
  openSlidesFor(file);
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";

function SlideView({ body, scale = 1, small = false }: { body: string; scale?: number; small?: boolean }) {
  return (
    <div className={cn("gear-slide prose-sm mx-auto w-full max-w-[1000px] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", small ? "pointer-events-none" : "")} style={{ fontSize: `${(small ? 0.42 : 1.55) * scale}em` }}>
      <Streamdown components={components}>{body || "*(empty slide)*"}</Streamdown>
    </div>
  );
}

export const SlidesPane = forwardRef<EditorPaneHandle, { path: string }>(function SlidesPane({ path }, ref) {
  const file = path.slice(SCHEME.length);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [showNotes, setShowNotes] = useState(false);
  const [overview, setOverview] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [full, setFull] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await native.readFile(file).catch((e) => ({ kind: "error" as const, message: String(e) }));
    if (r.kind !== "text") return void setError(r.kind === "error" ? r.message : "This file is not text.");
    setError(null);
    setDeck(parseDeck(r.content));
  }, [file]);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  useEffect(() => {
    if (startedAt === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useImperativeHandle(ref, () => toolPaneHandle(path, { reload: () => (void load(), true), focus: () => root.current?.focus() }), [path, load]);

  const count = deck?.slides.length ?? 0;
  const at = clampIndex(index, count);
  const slide = deck?.slides[at];
  const scale = useMemo(() => (slide ? fitScale(slide.body) : 1), [slide]);
  const talk = useMemo(() => (deck ? speakingSeconds(deck) : 0), [deck]);

  const go = (to: number) => {
    setIndex(clampIndex(to, count));
    if (startedAt === null && to !== at) setStartedAt(Date.now());
  };

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else root.current?.requestFullscreen?.().catch(() => toast.info("Full screen is not available here — use the window's own full-screen mode."));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape" && overview) return void (e.preventDefault(), setOverview(false));
    if (e.key === "o" || e.key === "g") return void (e.preventDefault(), setOverview(!overview));
    if (e.key === "s") return void (e.preventDefault(), setShowNotes(!showNotes));
    if (e.key === "f") return void (e.preventDefault(), toggleFull());
    if (e.key === "t") return void (e.preventDefault(), setStartedAt(Date.now()), setNow(Date.now()));
    const to = navigate(e.key, at, count);
    if (to !== null) (e.preventDefault(), go(to));
  };

  if (error) return <div className="p-6 text-[12.5px] text-red-500">{error}</div>;
  if (!deck) return <div className="p-6 text-[12.5px] text-muted-foreground">Reading the file…</div>;
  if (!count)
    return (
      <div className="p-6 text-[12.5px] text-muted-foreground">
        This file has no content yet. Write Markdown and put a line with three dashes (<code>---</code>) between slides.
      </div>
    );

  return (
    <div ref={root} tabIndex={0} data-slides className="flex h-full flex-col bg-background text-[12.5px] outline-none" onKeyDown={onKeyDown}>
      {!full && (
        <div className="flex items-center gap-1.5 border-b border-border/60 p-2">
          <span className="min-w-0 flex-1 truncate font-medium" title={file}>
            {deck.title ?? deck.slides[0].title}
          </span>
          {talk > 0 && <span className="text-muted-foreground">notes ≈ {formatElapsed(talk)}</span>}
          <button type="button" className={cn(btn, overview && "bg-muted font-medium")} title="O" onClick={() => setOverview(!overview)}>
            Overview
          </button>
          <button type="button" className={cn(btn, showNotes && "bg-muted font-medium")} title="S" onClick={() => setShowNotes(!showNotes)}>
            Notes
          </button>
          <button type="button" className={btn} title="F" onClick={toggleFull}>
            Full screen
          </button>
          <button type="button" className={btn} title="Go to this slide in the Markdown file" onClick={() => slide && app().openFile(file, slide.line)}>
            Edit slide
          </button>
        </div>
      )}
      {overview ? (
        <div className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(220px,1fr))] content-start gap-3 overflow-auto p-3">
          {deck.slides.map((s, i) => (
            <button key={i} type="button" data-thumb={i} className={cn("relative h-[140px] overflow-hidden rounded-md border bg-background p-2 text-left", i === at ? "border-primary" : "border-border/60 hover:border-ring")} onClick={() => (go(i), setOverview(false), root.current?.focus())}>
              <SlideView body={s.body} small />
              <span className="absolute bottom-1 right-1.5 rounded bg-muted px-1 text-[10.5px] tabular-nums">{i + 1}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 items-center overflow-auto p-8" data-slide={at} onClick={() => root.current?.focus()}>
            {slide && <SlideView body={slide.body} scale={scale} />}
          </div>
          {showNotes && slide && (
            <div className="flex w-[320px] shrink-0 flex-col border-l border-border/60">
              <div className="border-b border-border/60 px-2 py-1 font-medium">Notes</div>
              <div className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-2 text-[13.5px] leading-relaxed" data-notes>
                {slide.notes || <span className="text-muted-foreground">No notes for this slide. Add a line starting with “Note:” and write below it.</span>}
              </div>
              {deck.slides[at + 1] && (
                <div className="border-t border-border/60 p-2">
                  <div className="mb-1 text-muted-foreground">Next</div>
                  <div className="h-[110px] overflow-hidden rounded border border-border/60 p-2">
                    <SlideView body={deck.slides[at + 1].body} small />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <div className="h-0.5 bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${((at + 1) / count) * 100}%` }} />
      </div>
      <div className="flex items-center gap-2 px-2 py-1 text-muted-foreground">
        <button type="button" className={btn} disabled={at === 0} onClick={() => go(at - 1)}>
          ←
        </button>
        <span className="tabular-nums" data-position>
          {at + 1} / {count}
        </span>
        <button type="button" className={btn} disabled={at === count - 1} onClick={() => go(at + 1)}>
          →
        </button>
        <span className="min-w-0 flex-1 truncate">{slide?.title}</span>
        <button type="button" className="tabular-nums hover:text-foreground" title="Click or press T to restart the clock" onClick={() => (setStartedAt(Date.now()), setNow(Date.now()))}>
          {startedAt === null ? "00:00" : formatElapsed((now - startedAt) / 1000)}
        </button>
        {!full && <span>← → to move · O overview · S notes · F full screen</span>}
      </div>
    </div>
  );
});

export const SLIDES_ACTIONS = [
  { id: "slides.open", label: "Slides: Present this Markdown file", keywords: ["slides", "presentation", "present", "deck", "slideshow", "talk", "powerpoint", "keynote"], run: openSlidesForActive },
  { id: "slides.new", label: "Slides: New slide deck…", keywords: ["slides", "presentation", "deck", "new", "create"], run: () => void newDeck() },
];
