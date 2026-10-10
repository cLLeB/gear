// CPU profile viewer: a canvas flamegraph (click to zoom, double-click to
// open the source, search to highlight), a functions table (self / total /
// calls, click to focus a function's callees) and the hot path.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { focusFunction, formatValue, frameColor, functionStats, hotPath, parseProfile, type CallNode, type FunctionStat, type Profile } from "./model";

const ROW = 18;

interface Layout {
  start: Map<number, number>;
}

function layout(profile: Profile): Layout {
  const start = new Map<number, number>();
  const walk = (n: CallNode, s: number) => {
    start.set(n.id, s);
    let x = s;
    for (const c of n.children) {
      walk(c, x);
      x += c.total;
    }
  };
  walk(profile.root, 0);
  return { start };
}

function ancestors(n: CallNode): CallNode[] {
  const out: CallNode[] = [];
  for (let p = n.parent; p; p = p.parent) out.unshift(p);
  return out;
}

function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

function openFrame(n: CallNode): void {
  const f = n.frame.file;
  if (!f || /^(node:|<|\(|internal)/.test(f)) return;
  app().openFile(f, n.frame.line ?? undefined);
}

function Flame({ profile, query, onHover }: { profile: Profile; query: string; onHover: (n: CallNode | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<CallNode>(profile.root);
  const [width, setWidth] = useState(800);
  const lay = useMemo(() => layout(profile), [profile]);
  useEffect(() => setZoom(profile.root), [profile]);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const lead = ancestors(zoom);
  const height = (profile.maxDepth + 2) * ROW;
  const re = useMemo(() => {
    if (!query.trim()) return null;
    try {
      return new RegExp(query, "i");
    } catch {
      return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    }
  }, [query]);

  const draw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = height * dpr;
    c.style.width = `${width}px`;
    c.style.height = `${height}px`;
    const g = c.getContext("2d");
    if (!g) return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, width, height);
    g.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    g.textBaseline = "middle";
    const dark = isDark();
    const scale = width / Math.max(zoom.total, 1e-9);
    const zx = lay.start.get(zoom.id) ?? 0;
    const bar = (x: number, w: number, y: number, n: CallNode, faded: boolean) => {
      const matched = re ? re.test(n.frame.name) || re.test(n.frame.file ?? "") : false;
      g.globalAlpha = re && !matched ? 0.25 : faded ? 0.55 : 1;
      g.fillStyle = matched ? (dark ? "#b45309" : "#fbbf24") : frameColor(n.frame, dark);
      g.fillRect(x, y, Math.max(w - 0.5, 0.5), ROW - 1);
      if (w > 28) {
        g.fillStyle = dark ? "#f4f4f5" : "#18181b";
        const label = n.depth === 0 ? `all · ${formatValue(n.total, profile.unit)}` : n.frame.name;
        const maxChars = Math.floor((w - 6) / 6.6);
        g.fillText(label.length > maxChars ? `${label.slice(0, Math.max(0, maxChars - 1))}…` : label, x + 3, y + ROW / 2);
      }
      g.globalAlpha = 1;
    };
    // Ancestors of the zoomed node fill the width above it.
    lead.forEach((n, i) => bar(0, width, i * ROW, n, true));
    const top = lead.length;
    const walk = (n: CallNode) => {
      const x = ((lay.start.get(n.id) ?? 0) - zx) * scale;
      const w = n.total * scale;
      if (w < 0.4 || x > width || x + w < 0) return;
      bar(x, w, (top + n.depth - zoom.depth) * ROW, n, false);
      for (const ch of n.children) walk(ch);
    };
    walk(zoom);
  }, [width, height, zoom, lay, lead, re, profile.unit]);
  useEffect(draw, [draw]);

  const hit = (ev: React.MouseEvent): CallNode | null => {
    const rect = canvas.current!.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const row = Math.floor((ev.clientY - rect.top) / ROW);
    if (row < lead.length) return lead[row];
    const depth = row - lead.length + zoom.depth;
    const scale = width / Math.max(zoom.total, 1e-9);
    const zx = lay.start.get(zoom.id) ?? 0;
    const find = (n: CallNode): CallNode | null => {
      const nx = ((lay.start.get(n.id) ?? 0) - zx) * scale;
      const w = n.total * scale;
      if (x < nx || x > nx + w) return null;
      if (n.depth === depth) return n;
      for (const c of n.children) {
        const f = find(c);
        if (f) return f;
      }
      return null;
    };
    return find(zoom);
  };

  return (
    <div ref={wrap} className="relative w-full">
      <canvas
        ref={canvas}
        className="block cursor-pointer"
        onMouseMove={(e) => onHover(hit(e))}
        onMouseLeave={() => onHover(null)}
        onClick={(e) => {
          const n = hit(e);
          if (!n) return;
          if (e.metaKey || e.ctrlKey) openFrame(n);
          else setZoom(n);
        }}
        onDoubleClick={(e) => {
          const n = hit(e);
          if (n) openFrame(n);
        }}
      />
      {zoom !== profile.root ? (
        <button type="button" className="absolute right-2 top-1 rounded bg-background/90 px-2 py-0.5 text-[11px] shadow hover:bg-muted" onClick={() => setZoom(profile.root)}>
          Reset zoom
        </button>
      ) : null}
    </div>
  );
}

function FunctionTable({ profile, onFocus, query }: { profile: Profile; onFocus: (s: FunctionStat) => void; query: string }) {
  const [sort, setSort] = useState<"self" | "total" | "calls">("self");
  const stats = useMemo(() => functionStats(profile), [profile]);
  const total = profile.root.total || 1;
  const q = query.toLowerCase();
  const rows = stats.filter((s) => !q || s.frame.name.toLowerCase().includes(q) || (s.frame.file ?? "").toLowerCase().includes(q)).sort((a, b) => b[sort] - a[sort]).slice(0, 500);
  const th = (k: typeof sort, label: string) => (
    <th className={cn("cursor-pointer px-2 py-1 text-right font-medium", sort === k && "text-primary")} onClick={() => setSort(k)}>
      {label}
      {sort === k ? " ↓" : ""}
    </th>
  );
  return (
    <table className="w-full border-collapse text-[11.5px]">
      <thead className="sticky top-0 bg-background">
        <tr className="border-b">
          {th("self", "Self")}
          {th("total", "Total")}
          {th("calls", "Frames")}
          <th className="px-2 py-1 text-left font-medium">Function</th>
          <th className="px-2 py-1 text-left font-medium">Location</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.key} className="cursor-pointer border-b border-border/30 hover:bg-muted/50" onClick={() => onFocus(s)} title="Click to see what this function calls · double-click to open the source" onDoubleClick={() => s.frame.file && app().openFile(s.frame.file, s.frame.line ?? undefined)}>
            <td className="px-2 py-0.5 text-right tabular-nums">
              <span className="inline-block w-12 text-muted-foreground">{((s.self / total) * 100).toFixed(1)}%</span> {formatValue(s.self, profile.unit)}
            </td>
            <td className="px-2 py-0.5 text-right tabular-nums">
              <span className="inline-block w-12 text-muted-foreground">{((s.total / total) * 100).toFixed(1)}%</span> {formatValue(s.total, profile.unit)}
            </td>
            <td className="px-2 py-0.5 text-right tabular-nums text-muted-foreground">{s.calls}</td>
            <td className="max-w-[320px] truncate px-2 py-0.5 font-mono">{s.frame.name}</td>
            <td className="max-w-[360px] truncate px-2 py-0.5 text-muted-foreground" title={s.frame.file ?? ""}>
              {s.frame.file ? `${s.frame.file.replace(/^.*[\\/]/, "")}${s.frame.line ? `:${s.frame.line}` : ""}` : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const ProfilePane = forwardRef<EditorPaneHandle, { path: string }>(function ProfilePane({ path }, ref) {
  const [base, setBase] = useState<Profile | null>(null);
  const [focused, setFocused] = useState<{ profile: Profile; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<CallNode | null>(null);
  const [view, setView] = useState<"flame" | "table">("flame");

  const load = useCallback(async () => {
    try {
      const r = await native.readFile(path);
      if (r.kind !== "text") throw new Error("Profile is too large or not text");
      setBase(parseProfile(r.content, path));
      setFocused(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [path]);
  useEffect(() => void load(), [load]);

  useImperativeHandle(
    ref,
    () => ({
      setQuery: (q: string) => setQuery(q),
      findNext: () => {},
      findPrevious: () => {},
      clearQuery: () => setQuery(""),
      focus: () => {},
      getSelection: () => null,
      getPath: () => path,
      reload: () => {
        void load();
        return true;
      },
      gotoLine: () => {},
      undo: () => {},
      redo: () => {},
      openFindReplace: () => {},
      toggleBlame: () => {},
      save: async () => {},
    }),
    [load, path],
  );

  if (error) return <div className="flex h-full items-center justify-center p-6 text-[12px] text-destructive">{error}</div>;
  if (!base) return <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">Loading profile…</div>;
  const profile = focused?.profile ?? base;
  const total = base.root.total || 1;
  // Runtime internals (node:…, <frozen …>, anonymous loader glue) only add noise to the hot path.
  const hot = hotPath(profile, 0.25).filter((n) => n.frame.file && !/^(node:|<|internal)/.test(n.frame.file) && !(n.frame.name === "(anonymous)" && !/\.[cm]?[jt]sx?$|\.py$/.test(n.frame.file)));
  const btn = (active: boolean) => cn("rounded px-2 py-0.5 text-[11.5px]", active ? "bg-primary/15 text-primary" : "hover:bg-muted");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-2">
        <span className="truncate text-[12px] font-medium">{base.name}</span>
        <span className="text-[11px] text-muted-foreground">{formatValue(base.root.total, base.unit)} total</span>
        <span className="mx-1 h-4 w-px bg-border" />
        <button type="button" className={btn(view === "flame")} onClick={() => setView("flame")}>
          Flame graph
        </button>
        <button type="button" className={btn(view === "table")} onClick={() => setView("table")}>
          Functions
        </button>
        {focused ? (
          <button type="button" className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300" onClick={() => setFocused(null)} title="Back to the whole profile">
            ✕ focused on {focused.label}
          </button>
        ) : null}
        <input className="ml-auto w-56 rounded border border-border/60 bg-transparent px-2 py-0.5 text-[11.5px]" placeholder="Search functions / files (regex)…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {hot.length ? (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-border/40 px-2 py-1 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Hot path:</span>
          {hot.map((n, i) => (
            <button key={n.id} type="button" className="hover:text-foreground hover:underline" onClick={() => openFrame(n)} title={`${n.frame.file ?? ""}${n.frame.line ? `:${n.frame.line}` : ""}`}>
              {i ? "› " : ""}
              {n.frame.name} <span className="opacity-70">{((n.total / total) * 100).toFixed(0)}%</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {view === "flame" ? (
          <Flame profile={profile} query={query} onHover={setHover} />
        ) : (
          <FunctionTable
            profile={profile}
            query={query}
            onFocus={(s) => {
              setFocused({ profile: focusFunction(base, s.key), label: s.frame.name });
              setView("flame");
            }}
          />
        )}
      </div>
      <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border/60 px-2 text-[11px] text-muted-foreground">
        {hover ? (
          <>
            <span className="max-w-[40%] truncate font-mono text-foreground">{hover.frame.name}</span>
            <span>
              total {formatValue(hover.total, profile.unit)} ({((hover.total / total) * 100).toFixed(1)}%)
            </span>
            <span>self {formatValue(hover.self, profile.unit)}</span>
            <span className="truncate">{hover.frame.file ? `${hover.frame.file}${hover.frame.line ? `:${hover.frame.line}` : ""}` : ""}</span>
          </>
        ) : (
          <span>Click a frame to zoom · double-click (or Ctrl+click) to open its source · click a function in the table to see what it calls</span>
        )}
      </div>
    </div>
  );
});
