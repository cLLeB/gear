// gear-er://<profile>: an ER diagram of a connection's schema. Pan (drag the
// background), zoom (wheel / pinch), drag tables (positions are remembered),
// hover or click a table to light up its relationships, search to focus one,
// show keys only, export SVG, double-click a table to open it.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { app } from "@/app/appBridge";
import { columnY, edgePath, HEADER, layout, ROW, tableKey, type ErNode } from "./er";
import { connect, openConsole, profileById, refreshSchema, useDbStore } from "./store";

export const ER_SCHEME = "gear-er://";
const POS_KEY = (id: string) => `gear-er-positions:${id}`;

export const ErPane = forwardRef<EditorPaneHandle, { path: string }>(function ErPane({ path }, ref) {
  const profileId = path.slice(ER_SCHEME.length);
  const profile = profileById(profileId);
  const tables = useDbStore((s) => s.schema[profileId]);
  const [schemaFilter, setSchemaFilter] = useState<string | null>(null);
  const [keysOnly, setKeysOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState({ x: 20, y: 20, k: 1 });
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>(() => {
    try {
      return JSON.parse(localStorage.getItem(POS_KEY(profileId)) ?? "{}") as Record<string, { x: number; y: number }>;
    } catch {
      return {};
    }
  });
  const svg = useRef<SVGSVGElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tables) void connect(profileId).then(() => refreshSchema(profileId)).catch((e) => toast.error("Couldn't connect", { description: String(e) }));
  }, [profileId, tables]);

  const schemas = useMemo(() => [...new Set((tables ?? []).map((t) => t.schema))], [tables]);
  const shown = useMemo(() => (tables ?? []).filter((t) => t.kind === "table" && (!schemaFilter || t.schema === schemaFilter)), [tables, schemaFilter]);
  const base = useMemo(() => layout(shown, { keysOnly }), [shown, keysOnly]);
  const nodes: ErNode[] = useMemo(() => base.nodes.map((n) => (moved[n.key] ? { ...n, ...moved[n.key] } : n)), [base, moved]);
  const byKey = useMemo(() => new Map(nodes.map((n) => [n.key, n])), [nodes]);

  // Fit to the window once per layout.
  useEffect(() => {
    const el = box.current;
    if (!el || !base.width) return;
    const k = Math.min(1.2, Math.max(0.2, Math.min((el.clientWidth - 40) / base.width, (el.clientHeight - 40) / base.height)));
    setView({ x: 20, y: 20, k });
  }, [base.width, base.height]);

  const active = focus ?? hover;
  const related = useMemo(() => {
    if (!active) return null;
    const s = new Set([active]);
    for (const e of base.edges) {
      if (e.from === active) s.add(e.to);
      if (e.to === active) s.add(e.from);
    }
    return s;
  }, [active, base.edges]);

  const centerOn = (key: string) => {
    const n = byKey.get(key);
    const el = box.current;
    if (!n || !el) return;
    const k = Math.max(view.k, 0.8);
    setView({ k, x: el.clientWidth / 2 - (n.x + n.w / 2) * k, y: el.clientHeight / 2 - (n.y + n.h / 2) * k });
    setFocus(key);
  };

  useEffect(() => {
    if (!query) return;
    const hit = nodes.find((n) => n.table.name.toLowerCase().includes(query.toLowerCase()));
    if (hit) centerOn(hit.key);
  }, [query]);

  // Pan / drag.
  const drag = useRef<{ kind: "pan" | "node"; key?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const onDown = (e: React.PointerEvent, key?: string) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const n = key ? byKey.get(key) : undefined;
    drag.current = { kind: key ? "node" : "pan", key, sx: e.clientX, sy: e.clientY, ox: n ? n.x : view.x, oy: n ? n.y : view.y, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.kind === "pan") setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
    else setMoved((m) => ({ ...m, [d.key!]: { x: d.ox + dx / view.k, y: d.oy + dy / view.k } }));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === "node" && d.moved) {
      setMoved((m) => {
        try {
          localStorage.setItem(POS_KEY(profileId), JSON.stringify(m));
        } catch {
          /* ignore */
        }
        return m;
      });
    } else if (d.kind === "node") setFocus((f) => (f === d.key ? null : d.key!));
    else if (!d.moved) setFocus(null);
  };
  const onWheel = (e: React.WheelEvent) => {
    const el = box.current!;
    const r = el.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const k = Math.min(3, Math.max(0.15, view.k * Math.exp(-e.deltaY * 0.0015)));
    setView({ k, x: mx - ((mx - view.x) * k) / view.k, y: my - ((my - view.y) * k) / view.k });
  };

  const exportSvg = async () => {
    const el = svg.current;
    if (!el) return;
    const clone = el.cloneNode(true) as SVGSVGElement;
    clone.querySelector("g")?.setAttribute("transform", "translate(20 20)");
    clone.setAttribute("width", String(Math.ceil(Math.max(...nodes.map((n) => n.x + n.w)) + 40)));
    clone.setAttribute("height", String(Math.ceil(Math.max(...nodes.map((n) => n.y + n.h)) + 40)));
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    // Inline the theme colours so the file looks the same outside the app.
    const cs = getComputedStyle(el);
    clone.setAttribute("style", `background:${getComputedStyle(box.current!).backgroundColor};color:${cs.color};font-family:${cs.fontFamily}`);
    const rootDir = app().workspaceRoot();
    if (!rootDir) return void toast.error("Open a folder to save the diagram into");
    const file = `${rootDir}/${(profile?.name ?? "schema").replace(/[^\w.-]+/g, "_")}-er.svg`;
    await native.writeFile(file, new XMLSerializer().serializeToString(clone), "user");
    toast.success(`Saved ${file.split("/").pop()}`, { action: { label: "Open", onClick: () => app().openFile(file) } });
  };

  useImperativeHandle(
    ref,
    () =>
      ({
        setQuery,
        findNext: () => {},
        findPrevious: () => {},
        clearQuery: () => setQuery(""),
        focus: () => {},
        getSelection: () => null,
        getPath: () => path,
        reload: () => (void refreshSchema(profileId), true),
        gotoLine: () => {},
        undo: () => {},
        redo: () => {},
        openFindReplace: () => {},
        toggleBlame: () => {},
        save: async () => {},
      }) as EditorPaneHandle,
    [path, profileId],
  );

  if (!profile) return <div className="p-6 text-[12px] text-muted-foreground">This connection no longer exists.</div>;
  if (!tables) return <div className="p-6 text-[12px] text-muted-foreground">Reading the schema of {profile.name}…</div>;
  const btn = (on: boolean) => cn("rounded px-2 py-0.5 text-[11.5px]", on ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted");
  return (
    <div className="flex h-full flex-col text-[12px]">
      <div className="flex items-center gap-1.5 border-b border-border/60 px-3 py-1.5">
        <span className="font-medium">{profile.name}</span>
        <span className="text-[11px] text-muted-foreground">
          {shown.length} tables · {base.edges.length} relationships
        </span>
        {schemas.length > 1 && (
          <select className="rounded border border-border/60 bg-background px-1 py-0.5 text-[11.5px]" value={schemaFilter ?? ""} onChange={(e) => (setSchemaFilter(e.target.value || null), setMoved({}))}>
            <option value="">All schemas</option>
            {schemas.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        )}
        <span className="flex-1" />
        <input className="w-40 rounded border border-border/60 bg-background px-2 py-0.5" placeholder="Find table" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="button" className={btn(keysOnly)} onClick={() => setKeysOnly((x) => !x)}>
          Keys only
        </button>
        <button
          type="button"
          className={btn(false)}
          onClick={() => {
            setMoved({});
            localStorage.removeItem(POS_KEY(profileId));
          }}
        >
          Re-layout
        </button>
        <button type="button" className={btn(false)} onClick={() => void exportSvg()}>
          Export SVG
        </button>
      </div>
      <div ref={box} className="relative min-h-0 flex-1 overflow-hidden bg-muted/20" onWheel={onWheel} onPointerDown={(e) => onDown(e)} onPointerMove={onMove} onPointerUp={onUp}>
        {!shown.length && <div className="p-6 text-muted-foreground">No tables.</div>}
        <svg ref={svg} className="h-full w-full select-none text-foreground" style={{ cursor: drag.current?.kind === "pan" ? "grabbing" : "grab" }}>
          <defs>
            <marker id="er-one" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="10" markerHeight="10" orient="auto-start-reverse">
              <path d="M 6 0 L 6 10 M 9 0 L 9 10" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </marker>
            <marker id="er-many" viewBox="0 0 10 10" refX="0" refY="5" markerWidth="10" markerHeight="10" orient="auto-start-reverse">
              <path d="M 10 0 L 0 5 L 10 10 M 0 5 L 10 5" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </marker>
          </defs>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {base.edges.map((e) => {
              const a = byKey.get(e.from);
              const b = byKey.get(e.to);
              if (!a || !b) return null;
              const lit = !related || (related.has(e.from) && related.has(e.to) && (e.from === active || e.to === active));
              return (
                <path
                  key={`${e.from}-${e.name}`}
                  d={edgePath(a, columnY(a, e.columns[0], keysOnly), b, columnY(b, e.refColumns[0], keysOnly))}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={lit && related ? 1.8 : 1.1}
                  opacity={lit ? (related ? 0.9 : 0.45) : 0.08}
                  markerStart="url(#er-many)"
                  markerEnd="url(#er-one)"
                >
                  <title>{`${e.from}(${e.columns.join(", ")}) → ${e.to}(${e.refColumns.join(", ")})`}</title>
                </path>
              );
            })}
            {nodes.map((n) => {
              const dim = related && !related.has(n.key);
              const fkCols = new Set((n.table.foreignKeys ?? []).flatMap((f) => f.columns));
              const cols = keysOnly ? n.table.columns.filter((c) => c.primaryKey || fkCols.has(c.name)) : n.table.columns;
              return (
                <g
                  key={n.key}
                  transform={`translate(${n.x} ${n.y})`}
                  opacity={dim ? 0.25 : 1}
                  style={{ cursor: "move" }}
                  onPointerDown={(e) => onDown(e, n.key)}
                  onPointerEnter={() => setHover(n.key)}
                  onPointerLeave={() => setHover(null)}
                  onDoubleClick={() => openConsole(profileId, { schema: n.table.schema, name: n.table.name })}
                >
                  <rect width={n.w} height={n.h} rx={6} className="fill-background" stroke="currentColor" strokeOpacity={focus === n.key ? 0.9 : 0.25} strokeWidth={focus === n.key ? 2 : 1} />
                  <rect width={n.w} height={HEADER} rx={6} className="fill-primary/15" />
                  <text x={10} y={17} fontSize={12} fontWeight={600} fill="currentColor">
                    {schemas.length > 1 && !schemaFilter ? `${n.table.schema}.` : ""}
                    {n.table.name}
                  </text>
                  {cols.map((c, i) => (
                    <g key={c.name} transform={`translate(0 ${HEADER + i * ROW})`}>
                      <text x={10} y={13} fontSize={11.5} fill="currentColor" fontWeight={c.primaryKey ? 600 : 400}>
                        {c.primaryKey ? "🔑 " : fkCols.has(c.name) ? "↗ " : ""}
                        {c.name}
                      </text>
                      <text x={n.w - 10} y={13} fontSize={10.5} textAnchor="end" fill="currentColor" opacity={0.5}>
                        {c.dataType}
                        {c.nullable ? "" : " !"}
                      </text>
                    </g>
                  ))}
                </g>
              );
            })}
          </g>
        </svg>
        <div className="pointer-events-none absolute bottom-2 right-3 text-[10.5px] text-muted-foreground">
          {Math.round(view.k * 100)}% · drag to pan · wheel to zoom · double-click a table to open it
        </div>
      </div>
    </div>
  );
});

export const erPath = (profileId: string) => `${ER_SCHEME}${profileId}`;
export { tableKey };
