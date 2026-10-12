// Large log files: virtualized rows fetched from the Rust index, include /
// exclude filters (text or regex), level toggles, a time histogram (click to
// jump, drag to keep a time range), search with next / previous, follow mode
// (tail -f, survives rotation) and JSON log lines shown as message + fields.

import { invoke } from "@tauri-apps/api/core";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { inputBox } from "@/modules/quick-pick";
import { bucketAt, bucketRange, formatBytes, formatSpan, formatTime, LEVELS, LOG_SCHEME, structured, totals, type Histogram, type Level, type LogInfo, type Row } from "./model";

const ROW = 19;
const PAGE = 250;
const LEVEL_COLOR: Record<Level, string> = { error: "#ef4444", warn: "#f59e0b", info: "#3b82f6", debug: "#94a3b8", other: "#64748b" };
const LEVEL_TEXT: Record<Level, string> = { error: "text-red-500", warn: "text-amber-500", info: "", debug: "text-muted-foreground", other: "" };

function HistogramStrip({ h, onJump, onRange, range }: { h: Histogram; onJump: (t: number) => void; onRange: (r: { from: number; to: number } | null) => void; range: { from: number; to: number } | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const n = h.counts.length;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const hh = c.clientHeight;
    c.width = w * dpr;
    c.height = hh * dpr;
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, hh);
    const max = Math.max(1, ...h.counts.map((x) => x.reduce((a, b) => a + b, 0)));
    const bw = w / n;
    h.counts.forEach((counts, i) => {
      let y = hh;
      // Stack: other, debug, info, warn, error (errors on top, most visible).
      for (const li of [4, 3, 2, 1, 0]) {
        const v = counts[li];
        if (!v) continue;
        const bh = (v / max) * (hh - 2);
        g.fillStyle = LEVEL_COLOR[LEVELS[li]];
        g.globalAlpha = li >= 3 ? 0.45 : 0.85;
        g.fillRect(i * bw, y - bh, Math.max(1, bw - 0.5), bh);
        y -= bh;
      }
    });
    g.globalAlpha = 1;
    const sel = drag ? bucketRange(h, drag.a, drag.b) : range;
    if (sel) {
      const x0 = ((sel.from - h.start) / (h.bucketMs * n)) * w;
      const x1 = ((sel.to - h.start) / (h.bucketMs * n)) * w;
      g.fillStyle = "rgba(59,130,246,0.18)";
      g.fillRect(x0, 0, Math.max(2, x1 - x0), hh);
    }
  }, [h, n, drag, range]);
  const at = (e: React.MouseEvent) => bucketAt(e.clientX - e.currentTarget.getBoundingClientRect().left, e.currentTarget.clientWidth, n);
  const hoverCounts = hover !== null ? h.counts[hover] : null;
  return (
    <div className="relative border-b border-border/60 px-3 py-1">
      <canvas
        ref={ref}
        className="h-12 w-full cursor-crosshair"
        onMouseDown={(e) => setDrag({ a: at(e), b: at(e) })}
        onMouseMove={(e) => {
          setHover(at(e));
          if (drag && e.buttons) setDrag({ ...drag, b: at(e) });
        }}
        onMouseLeave={() => setHover(null)}
        onMouseUp={(e) => {
          if (!drag) return;
          const b = at(e);
          if (b === drag.a) onJump(h.start + b * h.bucketMs);
          else onRange(bucketRange(h, drag.a, b));
          setDrag(null);
        }}
      />
      <div className="flex justify-between text-[10.5px] text-muted-foreground">
        <span>{formatTime(h.start, true)}</span>
        <span>
          {hoverCounts && hover !== null
            ? `${formatTime(h.start + hover * h.bucketMs, false)} · ${LEVELS.map((l, i) => (hoverCounts[i] ? `${hoverCounts[i]} ${l}` : "")).filter(Boolean).join(" · ") || "no lines"}`
            : `${formatSpan(h.bucketMs)} buckets · click to jump · drag to filter${h.unparsed ? ` · ${h.unparsed} lines without time` : ""}`}
        </span>
        <span>{formatTime(h.start + n * h.bucketMs, true)}</span>
      </div>
    </div>
  );
}

function RowText({ row, json, highlight }: { row: Row; json: boolean; highlight: RegExp | null }) {
  const s = json ? structured(row.text) : null;
  const mark = (t: string) => {
    if (!highlight) return t;
    const parts: React.ReactNode[] = [];
    let last = 0;
    highlight.lastIndex = 0;
    for (const m of t.matchAll(highlight)) {
      if (!m[0]) break;
      parts.push(t.slice(last, m.index));
      parts.push(
        <mark key={m.index} className="rounded-sm bg-amber-400/40 text-inherit">
          {m[0]}
        </mark>,
      );
      last = m.index! + m[0].length;
    }
    parts.push(t.slice(last));
    return parts;
  };
  if (!s) return <>{mark(row.text)}</>;
  return (
    <>
      <span>{mark(s.message)}</span>
      {s.fields.map(([k, v]) => (
        <span key={k} className="ml-2 text-muted-foreground">
          <span className="text-sky-600 dark:text-sky-400">{k}</span>={mark(v)}
        </span>
      ))}
    </>
  );
}

export const LogPane = forwardRef<EditorPaneHandle, { path: string }>(function LogPane({ path }, ref) {
  const file = path.startsWith(LOG_SCHEME) ? path.slice(LOG_SCHEME.length) : path;
  const [info, setInfo] = useState<LogInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [levels, setLevels] = useState<Record<Level, boolean>>({ error: true, warn: true, info: true, debug: true, other: true });
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [follow, setFollow] = useState(false);
  const [json, setJson] = useState(true);
  const [showTime, setShowTime] = useState(true);
  const [hist, setHist] = useState<Histogram | null>(null);
  const [rows, setRows] = useState<Map<number, Row>>(new Map());
  const [view, setView] = useState({ top: 0, height: 600 });
  const [find, setFind] = useState("");
  const [hits, setHits] = useState<number[]>([]);
  const [hit, setHit] = useState(-1);
  const [selected, setSelected] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const loading = useRef(new Set<number>());
  const gen = useRef(0);

  const scrollToRow = useCallback((i: number) => {
    const el = scroller.current;
    if (el) el.scrollTop = Math.max(0, i * ROW - el.clientHeight / 2);
    setSelected(i);
  }, []);

  // Open / close.
  useEffect(() => {
    let id: number | null = null;
    invoke<LogInfo>("log_open", { path: file })
      .then((i) => {
        id = i.id;
        setInfo(i);
      })
      .catch((e) => setError(String(e)));
    return () => {
      if (id !== null) void invoke("log_close", { id });
    };
  }, [file]);

  const resetRows = () => {
    gen.current++;
    loading.current.clear();
    setRows(new Map());
  };

  // Filters → Rust view (debounced).
  const id = info?.id;
  useEffect(() => {
    if (id === undefined) return;
    const t = setTimeout(() => {
      const allLevels = LEVELS.every((l) => levels[l]);
      invoke<LogInfo>("log_filter", { id, spec: { include: include || null, exclude: exclude || null, regex, caseSensitive, levels: allLevels ? null : LEVELS.filter((l) => levels[l]), from: range?.from ?? null, to: range?.to ?? null } })
        .then((i) => {
          resetRows();
          setInfo(i);
          setError(null);
        })
        .catch((e) => toast.error("Filter", { description: String(e) }));
    }, 250);
    return () => clearTimeout(t);
  }, [id, include, exclude, regex, caseSensitive, levels, range]);

  // Histogram of the whole file (levels / time are what you filter by).
  const loadHist = useCallback(() => {
    if (id === undefined) return;
    const w = scroller.current?.clientWidth ?? 800;
    invoke<Histogram>("log_histogram", { id, buckets: Math.max(40, Math.min(400, Math.floor(w / 4))) }).then(setHist, () => setHist(null));
  }, [id]);
  useEffect(() => {
    if (info?.id !== undefined && !hist) loadHist();
  }, [info?.id, hist, loadHist]);

  // Fetch visible pages.
  const visible = info?.visible ?? 0;
  const first = Math.max(0, Math.floor(view.top / ROW) - 30);
  const last = Math.min(visible, Math.ceil((view.top + view.height) / ROW) + 30);
  useEffect(() => {
    if (id === undefined) return;
    const my = gen.current;
    for (let page = Math.floor(first / PAGE); page * PAGE < last; page++) {
      if (loading.current.has(page) || rows.has(page * PAGE)) continue;
      loading.current.add(page);
      invoke<Row[]>("log_rows", { id, start: page * PAGE, count: PAGE })
        .then((rs) => {
          if (my !== gen.current) return;
          setRows((old) => {
            const next = new Map(old);
            rs.forEach((r, i) => next.set(page * PAGE + i, r));
            // Keep memory bounded on huge files.
            if (next.size > 20_000) for (const k of [...next.keys()].filter((k) => Math.abs(k - first) > 10_000)) next.delete(k);
            return next;
          });
        })
        .finally(() => loading.current.delete(page));
    }
  }, [id, first, last, rows]);

  // Follow: poll for growth / rotation, stick to the bottom.
  useEffect(() => {
    if (!follow || id === undefined) return;
    const t = setInterval(async () => {
      const i = await invoke<LogInfo>("log_refresh", { id }).catch(() => null);
      if (!i) return;
      if (i.rotated) toast.info("The log was rotated or truncated — reloaded");
      setInfo((old) => {
        if (old && (i.visible !== old.visible || i.rotated)) {
          // Drop the last (possibly partial) page so it refetches.
          setRows((m) => {
            const next = i.rotated ? new Map<number, Row>() : new Map(m);
            if (!i.rotated) for (const k of [...next.keys()]) if (k >= Math.floor((old.visible - 1) / PAGE) * PAGE) next.delete(k);
            return next;
          });
          if (i.rotated || i.lines !== old.lines) setHist(null);
        }
        return i;
      });
      requestAnimationFrame(() => {
        const el = scroller.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [follow, id]);

  // Search.
  const findRe = useMemo(() => {
    if (!find) return null;
    try {
      return new RegExp(regex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi");
    } catch {
      return null;
    }
  }, [find, regex, caseSensitive]);
  useEffect(() => {
    if (id === undefined || !find) {
      setHits([]);
      setHit(-1);
      return;
    }
    const t = setTimeout(() => {
      invoke<number[]>("log_search", { id, pattern: find, regex, caseSensitive })
        .then((h) => {
          setHits(h);
          const start = h.findIndex((r) => r * ROW >= (scroller.current?.scrollTop ?? 0));
          const k = start < 0 ? 0 : start;
          setHit(h.length ? k : -1);
          if (h.length) scrollToRow(h[k]);
        })
        .catch(() => setHits([]));
    }, 300);
    return () => clearTimeout(t);
  }, [id, find, regex, caseSensitive, info?.visible, scrollToRow]);
  const step = (d: number) => {
    if (!hits.length) return;
    const k = (hit + d + hits.length) % hits.length;
    setHit(k);
    scrollToRow(hits[k]);
  };

  const gotoLine = async () => {
    const v = await inputBox({ title: "Go to line (file line number)", placeholder: "12345" });
    const n = Number(v) - 1;
    if (!Number.isFinite(n) || n < 0) return;
    // Rows are visible-row indexes; without a filter they equal line numbers.
    if (!include && !exclude && !range && LEVELS.every((l) => levels[l])) scrollToRow(Math.min(n, visible - 1));
    else toast.info("Clear the filters to jump to a file line");
  };

  // The tab host stores this handle in state, so it has to keep its identity between renders:
  // a fresh object on every render makes the host re-render, which renders this pane again, without end.
  // The methods read what they need through `live`, which always holds the latest render's values.
  const live = useRef({ step, gotoLine, selected, rows, id, resetRows });
  live.current = { step, gotoLine, selected, rows, id, resetRows };
  useImperativeHandle(
    ref,
    () =>
      ({
        setQuery: (q: string) => setFind(q),
        findNext: () => live.current.step(1),
        findPrevious: () => live.current.step(-1),
        clearQuery: () => setFind(""),
        focus: () => scroller.current?.focus(),
        getSelection: () => {
          const { selected, rows } = live.current;
          return selected !== null ? (rows.get(selected)?.text ?? null) : null;
        },
        getPath: () => path,
        reload: () => {
          const { id, resetRows } = live.current;
          if (id !== undefined) void invoke<LogInfo>("log_refresh", { id }).then((i) => (resetRows(), setInfo(i), setHist(null)));
          return true;
        },
        gotoLine: () => void live.current.gotoLine(),
        undo: () => {},
        redo: () => {},
        openFindReplace: () => {},
        toggleBlame: () => {},
        save: async () => {},
      }) as EditorPaneHandle,
    [path],
  );

  const t = totals(hist);
  const filtered = Boolean(include || exclude || range || !LEVELS.every((l) => levels[l]));
  const chip = (on: boolean) => cn("rounded px-1.5 py-0.5 text-[11px]", on ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted");
  const input = "rounded border border-border/60 bg-background px-2 py-0.5 text-[12px]";

  if (error) return <div className="p-6 text-[12px] text-destructive">{error}</div>;
  if (!info) return <div className="p-6 text-[12px] text-muted-foreground">Indexing {file.split("/").pop()}…</div>;
  return (
    <div className="flex h-full flex-col text-[12px]">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-3 py-1.5">
        <input className={cn(input, "w-44")} placeholder="Include" value={include} onChange={(e) => setInclude(e.target.value)} />
        <input className={cn(input, "w-36")} placeholder="Exclude" value={exclude} onChange={(e) => setExclude(e.target.value)} />
        <button type="button" className={chip(regex)} title="Regular expressions" onClick={() => setRegex((x) => !x)}>
          .*
        </button>
        <button type="button" className={chip(caseSensitive)} title="Match case" onClick={() => setCaseSensitive((x) => !x)}>
          Aa
        </button>
        <span className="mx-1 h-4 w-px bg-border" />
        {LEVELS.map((l) => (
          <button key={l} type="button" className={chip(levels[l])} onClick={(e) => setLevels((x) => (e.altKey ? (Object.fromEntries(LEVELS.map((k) => [k, k === l])) as Record<Level, boolean>) : { ...x, [l]: !x[l] }))} title="Alt-click: only this level">
            <span className="mr-1 inline-block size-1.5 rounded-full" style={{ background: LEVEL_COLOR[l] }} />
            {l} {hist ? t[l].toLocaleString() : ""}
          </button>
        ))}
        {range && (
          <button type="button" className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] text-primary" onClick={() => setRange(null)} title="Clear the time range">
            {formatTime(range.from, false)} – {formatTime(range.to, false)} ✕
          </button>
        )}
        <span className="flex-1" />
        <input className={cn(input, "w-36")} placeholder="Find" value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => e.key === "Enter" && step(e.shiftKey ? -1 : 1)} />
        {find && (
          <span className="tabular-nums text-[11px] text-muted-foreground">
            {hits.length ? `${hit + 1}/${hits.length.toLocaleString()}${hits.length >= 100_000 ? "+" : ""}` : "0"}
          </span>
        )}
        <button type="button" className={chip(showTime)} onClick={() => setShowTime((x) => !x)}>
          Time
        </button>
        <button type="button" className={chip(json)} title="Show JSON log lines as message + fields" onClick={() => setJson((x) => !x)}>
          JSON
        </button>
        <button type="button" className={chip(follow)} title="Follow the end of the file (tail -f)" onClick={() => setFollow((x) => !x)}>
          Follow
        </button>
      </div>
      {hist && hist.counts.length > 1 && (
        <HistogramStrip
          h={hist}
          range={range}
          onRange={setRange}
          onJump={(time) =>
            void invoke<number | null>("log_row_at_time", { id: info.id, time }).then((r) => {
              if (r !== null) scrollToRow(r);
            })
          }
        />
      )}
      <div
        ref={scroller}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto font-mono text-[12px] outline-none"
        onScroll={(e) => {
          const el = e.currentTarget;
          setView({ top: el.scrollTop, height: el.clientHeight });
          if (follow && el.scrollHeight - el.scrollTop - el.clientHeight > 4 * ROW) setFollow(false);
        }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "g") {
            e.preventDefault();
            void gotoLine();
          } else if (e.key === "F3") step(e.shiftKey ? -1 : 1);
        }}
      >
        <div style={{ height: visible * ROW, position: "relative" }}>
          {Array.from({ length: Math.max(0, last - first) }, (_, k) => first + k).map((i) => {
            const r = rows.get(i);
            const isHit = hits[hit] === i;
            return (
              <div
                key={i}
                className={cn("absolute left-0 right-0 flex whitespace-pre px-2", selected === i ? "bg-primary/10" : isHit ? "bg-amber-400/15" : "hover:bg-muted/40")}
                style={{ top: i * ROW, height: ROW, lineHeight: `${ROW}px` }}
                onClick={() => setSelected(i)}
                onDoubleClick={() => r && void navigator.clipboard.writeText(r.text).then(() => toast.success("Line copied"))}
              >
                <span className="w-16 shrink-0 select-none pr-2 text-right text-muted-foreground/60">{r ? r.line + 1 : ""}</span>
                <span className="w-1 shrink-0" style={{ background: r && r.level !== "other" ? LEVEL_COLOR[r.level] : undefined }} />
                {showTime && <span className="w-28 shrink-0 select-none pl-2 text-muted-foreground">{r?.time ? formatTime(r.time, false) : ""}</span>}
                <span className={cn("pl-2", r && LEVEL_TEXT[r.level])}>{r ? <RowText row={r} json={json} highlight={findRe} /> : <span className="text-muted-foreground/40">…</span>}</span>
              </div>
            );
          })}
        </div>
        {!visible && <div className="p-4 text-muted-foreground">{filtered ? "No lines match the filters." : "The file is empty."}</div>}
      </div>
      <div className="flex items-center gap-3 border-t border-border/60 px-3 py-0.5 text-[11px] text-muted-foreground">
        <span>
          {filtered ? `${visible.toLocaleString()} of ${info.lines.toLocaleString()} lines` : `${info.lines.toLocaleString()} lines`} · {formatBytes(info.size)}
        </span>
        {follow && <span className="text-emerald-600">● following</span>}
        <span className="flex-1" />
        <button type="button" className="hover:text-foreground" onClick={() => void gotoLine()}>
          Go to line…
        </button>
      </div>
    </div>
  );
});
