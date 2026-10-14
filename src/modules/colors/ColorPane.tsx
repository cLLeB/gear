// gear-color://: one colour in every notation, its contrast against a
// background (WCAG 2 and APCA) with a fix that passes, a 50–950 scale to
// export, harmonies, colour-blind previews, and every colour the workspace
// uses with near-duplicates grouped.

import { invoke } from "@tauri-apps/api/core";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { toolPaneHandle } from "@/modules/tools/paneHandle";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { apca, apcaUse, collectColors, exportScale, FORMATS, fixContrast, format, harmony, nameOf, parseColor, scale, simulate, toHex, wcagGrades, wcagRatio, type ExportStyle, type Format, type Harmony, type Rgb, type UsedColor, type Vision } from "./model";

export const COLOR_PATH = "gear-color://Colors";
const KEY = "gear.colors";
const SCAN_EXT = /\.(css|scss|sass|less|styl|html?|vue|svelte|astro|[jt]sx?|mjs|json|xml|svg|kt|swift|dart)$/i;
let seed = "";
/** "List every colour" before the pane exists: it scans when it mounts. */
let scanOnOpen = false;
/** Set while the pane is open, to start a scan from the palette. */
let startScan: (() => void) | null = null;

/** Opens the workbench; a colour selected in the editor is taken over. */
export function openColors(): void {
  const view = getActiveEditor()?.view;
  const sel = view ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to).trim().replace(/^["']|["';]$/g, "") : "";
  if (sel && sel.length < 60 && parseColor(sel)) seed = sel;
  app().openFile(COLOR_PATH);
}

interface Saved {
  fg: string;
  bg: string;
  name: string;
}

function load(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && typeof v.fg === "string") return { fg: v.fg, bg: typeof v.bg === "string" ? v.bg : "#ffffff", name: typeof v.name === "string" ? v.name : "brand" };
  } catch {
    // Defaults below.
  }
  return { fg: "#3b82f6", bg: "#ffffff", name: "brand" };
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const css = (c: Rgb) => format(c, "rgb");
const VISIONS: { id: Vision; label: string }[] = [
  { id: "normal", label: "Normal vision" },
  { id: "protanopia", label: "Protanopia (no red)" },
  { id: "deuteranopia", label: "Deuteranopia (no green)" },
  { id: "tritanopia", label: "Tritanopia (no blue)" },
  { id: "achromatopsia", label: "No colour" },
];
const HARMONIES: Harmony[] = ["complementary", "analogous", "triadic", "split", "tetradic"];

function Grade({ ok, label }: { ok: boolean; label: string }) {
  return <span className={cn("rounded px-1.5 py-0.5 text-[11px]", ok ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-red-500/15 text-red-600")}>{`${ok ? "✓" : "✗"} ${label}`}</span>;
}

type Tab = "scale" | "harmony" | "workspace";

export const ColorPane = forwardRef<EditorPaneHandle, { path: string }>(function ColorPane({ path }, ref) {
  const [saved, setSavedState] = useState<Saved>(() => {
    const s = load();
    if (seed) s.fg = seed;
    seed = "";
    return s;
  });
  const [fgText, setFgText] = useState(saved.fg);
  const [bgText, setBgText] = useState(saved.bg);
  const [vision, setVision] = useState<Vision>("normal");
  const [tab, setTab] = useState<Tab>("scale");
  const [exportStyle, setExportStyle] = useState<ExportStyle>("css");
  const [exportFormat, setExportFormat] = useState<Format>("hex");
  const [harm, setHarm] = useState<Harmony>("complementary");
  const [scan, setScan] = useState<{ colors: UsedColor[]; groups: UsedColor[][]; files: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [openColor, setOpenColor] = useState<string | null>(null);
  const live = useRef(saved);
  live.current = saved;

  const save = (patch: Partial<Saved>) => {
    const next = { ...live.current, ...patch };
    setSavedState(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Not remembered, then.
    }
  };

  useImperativeHandle(ref, () => toolPaneHandle(path, { getSelection: () => live.current.fg }), [path]);

  const fg = useMemo(() => parseColor(saved.fg) ?? parseColor("#3b82f6")!, [saved.fg]);
  const bg = useMemo(() => {
    const b = parseColor(saved.bg) ?? parseColor("#fff")!;
    return { ...b, alpha: 1 };
  }, [saved.bg]);
  const ratio = wcagRatio(fg, bg);
  const grades = wcagGrades(ratio);
  const lc = apca(fg, bg);
  const steps = useMemo(() => scale(fg), [fg]);
  const harmonies = useMemo(() => harmony(fg, harm), [fg, harm]);
  const show = (c: Rgb) => css(simulate(c, vision));
  const white = parseColor("#fff")!;
  const black = parseColor("#000")!;

  const setFg = (text: string) => {
    setFgText(text);
    if (parseColor(text)) save({ fg: text.trim() });
  };
  const setBg = (text: string) => {
    setBgText(text);
    if (parseColor(text)) save({ bg: text.trim() });
  };
  const pick = (c: Rgb) => setFg(toHex(c));

  const copy = (v: string, what = v) => void navigator.clipboard.writeText(v).then(() => toast.success(`Copied ${what}`));
  const insert = (v: string) => {
    const view = getActiveEditor()?.view;
    if (!view) return void toast.info("Open a file first.");
    view.dispatch(view.state.replaceSelection(v));
    toast.success("Inserted");
  };

  const runScan = async () => {
    const root = app().workspaceRoot();
    if (!root) return void toast.error("Open a folder first.");
    setScanning(true);
    try {
      const listed = await invoke<{ files: string[] }>("fs_list_files", { root, limit: 10000, maxDepth: 12, workspace: currentWorkspaceEnv() });
      const wanted = listed.files.filter((f) => SCAN_EXT.test(f) && !/(^|\/)(node_modules|dist|build|target|\.next|coverage|vendor)\//.test(f) && !/\.min\.|lock\.json$|\.map$/.test(f)).slice(0, 3000);
      const files: { path: string; text: string }[] = [];
      for (let i = 0; i < wanted.length; i += 24) {
        const batch = await Promise.all(
          wanted.slice(i, i + 24).map(async (rel) => {
            const full = `${root.replace(/[\\/]+$/, "")}/${rel}`;
            const r = await native.readFile(full).catch(() => null);
            return r && r.kind === "text" && r.content.length < 2_000_000 ? { path: rel, text: r.content } : null;
          }),
        );
        for (const f of batch) if (f) files.push(f);
      }
      setScan({ ...collectColors(files), files: files.length });
    } catch (err) {
      toast.error(`Could not scan: ${String(err)}`);
    } finally {
      setScanning(false);
    }
  };

  const scanRef = useRef(runScan);
  scanRef.current = runScan;
  useEffect(() => {
    startScan = () => {
      setTab("workspace");
      void scanRef.current();
    };
    if (scanOnOpen) {
      scanOnOpen = false;
      startScan();
    }
    return () => {
      startScan = null;
    };
  }, []);

  const openPlace = (rel: string, line: number, column: number) => {
    const root = app().workspaceRoot();
    if (root) app().openFile(`${root.replace(/[\\/]+$/, "")}/${rel}`, line, column);
  };

  const fixes = [4.5, 7].map((t) => ({ target: t, color: ratio >= t ? null : fixContrast(fg, bg, t) }));

  return (
    <div className="flex h-full overflow-auto text-[12.5px]">
      <div className="w-[360px] shrink-0 space-y-3 border-r border-border/60 p-3">
        <div className="flex items-center gap-2">
          <input type="color" className="h-9 w-12 cursor-pointer rounded border border-border/60 bg-transparent" value={toHex({ ...fg, alpha: 1 })} onChange={(e) => setFg(e.target.value)} title="Pick a colour" />
          <input className={cn("min-w-0 flex-1 rounded border bg-background px-2 py-1.5 font-mono text-[14px] outline-none focus:border-ring", parseColor(fgText) ? "border-border/60" : "border-red-500")} data-color-input value={fgText} spellCheck={false} placeholder="#3b82f6, rgb(…), oklch(…), tomato…" onChange={(e) => setFg(e.target.value)} />
        </div>
        <div className="h-20 rounded border border-border/60" style={{ background: show(fg) }} data-color-swatch />
        <div className="space-y-0.5" data-color-formats>
          {nameOf(fg) && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">name</span>
              <span className="font-mono">{nameOf(fg)}</span>
            </div>
          )}
          {FORMATS.map((f) => (
            <button key={f} type="button" className="flex w-full justify-between rounded px-1 hover:bg-muted/50" data-color-format={f} onClick={() => copy(format(fg, f))} title="Click to copy">
              <span className="text-muted-foreground">{f}</span>
              <span className="font-mono">{format(fg, f)}</span>
            </button>
          ))}
        </div>

        <div className="space-y-1.5 border-t border-border/60 pt-3">
          <div className="font-medium">Contrast</div>
          <div className="flex items-center gap-2">
            <span className="w-20 text-muted-foreground">Background</span>
            <input type="color" className="h-7 w-9 cursor-pointer rounded border border-border/60 bg-transparent" value={toHex(bg)} onChange={(e) => setBg(e.target.value)} />
            <input className={cn("min-w-0 flex-1 rounded border bg-background px-2 py-0.5 font-mono outline-none focus:border-ring", parseColor(bgText) ? "border-border/60" : "border-red-500")} data-color-bg value={bgText} spellCheck={false} onChange={(e) => setBg(e.target.value)} />
            <button type="button" className={btn} title="Swap text and background" onClick={() => (setFg(toHex(bg)), setBg(toHex({ ...fg, alpha: 1 })))}>
              ⇄
            </button>
          </div>
          <div className="rounded border border-border/60 p-3" style={{ background: show(bg), color: show(fg) }} data-color-preview>
            <div className="text-[22px] font-semibold leading-tight">Large heading</div>
            <div className="text-[14px]">Body text at a normal size, the quick brown fox.</div>
            <div className="text-[11px]">Small print and captions</div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[22px] font-semibold tabular-nums" data-color-ratio>
              {ratio.toFixed(2)}:1
            </span>
            <span className="text-muted-foreground">WCAG 2</span>
          </div>
          <div className="flex flex-wrap gap-1">
            <Grade ok={grades.aaNormal} label="AA text" />
            <Grade ok={grades.aaLarge} label="AA large" />
            <Grade ok={grades.aaaNormal} label="AAA text" />
            <Grade ok={grades.aaaLarge} label="AAA large" />
            <Grade ok={grades.ui} label="UI parts" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[16px] font-semibold tabular-nums" data-color-apca>
              Lc {lc.toFixed(1)}
            </span>
            <span className="text-muted-foreground">APCA — {apcaUse(lc)}</span>
          </div>
          {fixes.map(
            (f) =>
              f.color && (
                <div key={f.target} className="flex items-center gap-2" data-color-fix={f.target}>
                  <span className="h-4 w-4 rounded border border-border/60" style={{ background: css(f.color) }} />
                  <span className="font-mono">{toHex(f.color)}</span>
                  <span className="text-muted-foreground">
                    reaches {wcagRatio(f.color, bg).toFixed(2)}:1 ({f.target === 4.5 ? "AA" : "AAA"})
                  </span>
                  <span className="flex-1" />
                  <button type="button" className={btn} onClick={() => pick(f.color as Rgb)}>
                    Use
                  </button>
                </div>
              ),
          )}
        </div>

        <div className="space-y-1 border-t border-border/60 pt-3">
          <div className="font-medium">See it as</div>
          <select className="w-full rounded border border-border/60 bg-background px-1 py-0.5" data-color-vision value={vision} onChange={(e) => setVision(e.target.value as Vision)}>
            {VISIONS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          <div className="text-[11px] text-muted-foreground">Applies to every swatch and the preview. About 1 in 12 men has some red-green colour blindness.</div>
        </div>
      </div>

      <div className="flex min-w-[420px] flex-1 flex-col">
        <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1">
          {(
            [
              ["scale", "Scale"],
              ["harmony", "Harmonies"],
              ["workspace", "Colours in this workspace"],
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button key={t} type="button" data-color-tab={t} className={cn(btn, tab === t && "bg-muted font-medium")} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </div>

        {tab === "scale" && (
          <div className="space-y-3 p-3">
            <div className="grid grid-cols-11 gap-1" data-color-scale>
              {steps.map((s) => (
                <button key={s.step} type="button" className="text-left" onClick={() => copy(format(s.color, exportFormat))} title={`Copy ${format(s.color, exportFormat)}`}>
                  <div className={cn("h-16 rounded", s.isBase && "ring-2 ring-ring ring-offset-1 ring-offset-background")} style={{ background: show(s.color) }} />
                  <div className="mt-0.5 font-medium">{s.step}</div>
                  <div className="font-mono text-[10.5px] text-muted-foreground">{toHex(s.color)}</div>
                  <div className="text-[10.5px] tabular-nums text-muted-foreground" title="Contrast against white / black">
                    {wcagRatio(s.color, white).toFixed(1)} · {wcagRatio(s.color, black).toFixed(1)}
                  </div>
                </button>
              ))}
            </div>
            <div className="text-[11px] text-muted-foreground">Built in OKLCH so each step looks evenly lighter or darker; the outlined step is your colour. Numbers under each swatch: contrast against white · black.</div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Name</span>
              <input className="w-32 rounded border border-border/60 bg-background px-2 py-0.5 outline-none focus:border-ring" data-color-name value={saved.name} onChange={(e) => save({ name: e.target.value })} />
              <span className="text-muted-foreground">as</span>
              {(["css", "tailwind", "scss", "json"] as ExportStyle[]).map((s) => (
                <button key={s} type="button" data-export-style={s} className={cn(btn, exportStyle === s && "bg-muted font-medium")} onClick={() => setExportStyle(s)}>
                  {s === "css" ? "CSS variables" : s === "tailwind" ? "Tailwind v4" : s.toUpperCase()}
                </button>
              ))}
              <select className="rounded border border-border/60 bg-background px-1 py-0.5 text-[11.5px]" value={exportFormat} onChange={(e) => setExportFormat(e.target.value as Format)}>
                {FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <pre className="max-h-64 overflow-auto rounded bg-muted/40 p-2 font-mono text-[11.5px]" data-color-export>
              {exportScale(saved.name, steps, exportStyle, exportFormat)}
            </pre>
            <div className="flex gap-1.5">
              <button type="button" className={btn} onClick={() => copy(exportScale(saved.name, steps, exportStyle, exportFormat), "the scale")}>
                Copy
              </button>
              <button type="button" className={btn} onClick={() => insert(exportScale(saved.name, steps, exportStyle, exportFormat))}>
                Insert in editor
              </button>
            </div>
          </div>
        )}

        {tab === "harmony" && (
          <div className="space-y-3 p-3">
            <div className="flex flex-wrap gap-1">
              {HARMONIES.map((h) => (
                <button key={h} type="button" data-harmony={h} className={cn(btn, harm === h && "bg-muted font-medium")} onClick={() => setHarm(h)}>
                  {h === "split" ? "Split complementary" : h[0].toUpperCase() + h.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex gap-2" data-color-harmony>
              {harmonies.map((c, i) => (
                <div key={i} className="flex-1">
                  <div className="h-24 rounded border border-border/60" style={{ background: show(c) }} />
                  <div className="mt-1 flex items-center justify-between">
                    <span className="font-mono">{toHex(c)}</span>
                    <span className="flex gap-1">
                      <button type="button" className={btn} onClick={() => copy(toHex(c))}>
                        Copy
                      </button>
                      <button type="button" className={btn} onClick={() => pick(c)}>
                        Use
                      </button>
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[11px] text-muted-foreground">Hues are turned in OKLCH, so the colours keep the same perceived lightness and strength.</div>
          </div>
        )}

        {tab === "workspace" && (
          <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
            <div className="flex items-center gap-2">
              <button type="button" className={btn} data-color-scan disabled={scanning} onClick={() => void runScan()}>
                {scanning ? "Scanning…" : scan ? "Scan again" : "Find colours in this workspace"}
              </button>
              {scan && (
                <span className="text-muted-foreground" data-color-scan-summary>
                  {scan.colors.length} distinct colours in {scan.files} files
                  {scan.groups.length > 0 && ` · ${scan.groups.length} sets of near-duplicates`}
                </span>
              )}
            </div>
            {scan && scan.groups.length > 0 && (
              <section>
                <div className="mb-1 font-medium">Almost the same colour</div>
                <div className="mb-1 text-[11px] text-muted-foreground">These are hard to tell apart; using one of each set keeps the palette small.</div>
                {scan.groups.slice(0, 30).map((g) => (
                  <div key={g[0].hex} className="flex flex-wrap items-center gap-2 py-0.5" data-color-group>
                    {g.map((u) => (
                      <button key={u.hex} type="button" className="flex items-center gap-1 rounded px-1 hover:bg-muted/50" onClick={() => (setOpenColor(u.hex), pick(u.color))}>
                        <span className="h-4 w-4 rounded border border-border/60" style={{ background: show(u.color) }} />
                        <span className="font-mono">{u.hex}</span>
                        <span className="text-muted-foreground">×{u.count}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </section>
            )}
            {scan && (
              <section>
                <div className="mb-1 font-medium">All colours, most used first</div>
                {scan.colors.slice(0, 400).map((u) => (
                  <div key={u.hex} data-color-used={u.hex}>
                    <button type="button" className={cn("flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-muted/50", openColor === u.hex && "bg-muted")} onClick={() => setOpenColor(openColor === u.hex ? null : u.hex)}>
                      <span className="h-4 w-8 rounded border border-border/60" style={{ background: show(u.color) }} />
                      <span className="w-24 font-mono">{u.hex}</span>
                      <span className="w-12 text-right tabular-nums">×{u.count}</span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{u.spellings.join("  ")}</span>
                    </button>
                    {openColor === u.hex && (
                      <div className="mb-1 ml-10 space-y-0.5">
                        <button type="button" className={btn} onClick={() => pick(u.color)}>
                          Inspect this colour
                        </button>
                        {u.places.map((p, i) => (
                          <button key={i} type="button" className="block font-mono text-[11.5px] text-muted-foreground hover:text-foreground hover:underline" onClick={() => openPlace(p.file, p.line, p.column)}>
                            {p.file}:{p.line}:{p.column}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export const COLOR_ACTIONS = [
  { id: "colors.open", label: "Colors: Open the colour workbench (contrast, scales, formats)", keywords: ["color", "colour", "contrast", "wcag", "apca", "palette", "oklch", "hex", "rgb", "hsl", "tailwind", "scale", "accessibility", "color blind"], run: openColors },
  {
    id: "colors.scan",
    label: "Colors: List every colour used in this workspace",
    keywords: ["color", "colour", "palette", "audit", "duplicates", "css", "design tokens"],
    run: () => {
      if (startScan) startScan();
      else scanOnOpen = true;
      app().openFile(COLOR_PATH);
    },
  },
];
