// .heapsnapshot files: class summary (count, shallow, retained), instances,
// an object's retaining path from the root plus its retainers and references,
// and a comparison with another snapshot (what was allocated / freed between
// them — where leaks show up).

import { invoke } from "@tauri-apps/api/core";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";

interface HeapInfo {
  id: number;
  nodes: number;
  edges: number;
  totalSize: number;
  reachableSize: number;
}
interface ClassRow {
  class: number;
  name: string;
  count: number;
  shallow: number;
  retained: number;
  minDistance: number;
}
interface NodeRow {
  index: number;
  id: number;
  name: string;
  kind: string;
  class: string;
  shallow: number;
  retained: number;
  distance: number | null;
}
interface EdgeRow {
  edgeType: string;
  edgeName: string;
  node: NodeRow;
}
interface DiffRow {
  name: string;
  class: number | null;
  added: number;
  removed: number;
  addedSize: number;
  removedSize: number;
}

export function formatBytes(n: number): string {
  const a = Math.abs(n);
  const s = a < 1024 ? `${a} B` : a < 1 << 20 ? `${(a / 1024).toFixed(1)} KB` : `${(a / (1 << 20)).toFixed(1)} MB`;
  return n < 0 ? `−${s}` : s;
}

function nodeLabel(n: NodeRow): string {
  const name = n.kind === "string" || n.kind === "concatenated string" || n.kind === "sliced string" ? JSON.stringify(n.name.slice(0, 60)) : n.name || n.class;
  return `${name} @${n.id}`;
}

function Refs({ heap, node, depth = 0 }: { heap: number; node: NodeRow; depth?: number }) {
  const [refs, setRefs] = useState<EdgeRow[] | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  useEffect(() => {
    void invoke<EdgeRow[]>("heap_references", { id: heap, node: node.index }).then(setRefs);
  }, [heap, node.index]);
  if (!refs) return <div style={{ paddingLeft: 16 + depth * 14 }} className="text-muted-foreground">…</div>;
  return (
    <>
      {refs.slice(0, 100).map((r, i) => (
        <div key={i}>
          <div className="flex items-center gap-1.5 py-[1px] hover:bg-muted/30" style={{ paddingLeft: 8 + depth * 14 }}>
            <button type="button" className="w-3 text-[10px] text-muted-foreground" onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}>
              {depth < 8 ? (open[i] ? "▾" : "▸") : ""}
            </button>
            <span className={cn("font-mono", r.edgeType === "weak" && "text-muted-foreground line-through", r.edgeType === "internal" || r.edgeType === "hidden" ? "text-muted-foreground" : "text-sky-600 dark:text-sky-400")}>{r.edgeName}</span>
            <span className="text-muted-foreground">→</span>
            <span className="min-w-0 flex-1 truncate">{nodeLabel(r.node)}</span>
            <span className="w-20 text-right tabular-nums text-muted-foreground">{formatBytes(r.node.shallow)}</span>
            <span className="w-20 text-right tabular-nums">{formatBytes(r.node.retained)}</span>
          </div>
          {open[i] && depth < 8 && <Refs heap={heap} node={r.node} depth={depth + 1} />}
        </div>
      ))}
    </>
  );
}

function Details({ heap, node }: { heap: number; node: NodeRow }) {
  const [path, setPath] = useState<EdgeRow[]>([]);
  const [retainers, setRetainers] = useState<EdgeRow[]>([]);
  const [tab, setTab] = useState<"path" | "retainers" | "refs">("path");
  useEffect(() => {
    void invoke<EdgeRow[]>("heap_path", { id: heap, node: node.index }).then(setPath);
    void invoke<EdgeRow[]>("heap_retainers", { id: heap, node: node.index }).then(setRetainers);
  }, [heap, node.index]);
  const chip = (on: boolean) => cn("rounded px-2 py-0.5 text-[11.5px]", on ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted");
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-border/60 px-3 py-1">
        <span className="truncate font-medium">{nodeLabel(node)}</span>
        <span className="text-[11px] text-muted-foreground">
          {node.kind} · shallow {formatBytes(node.shallow)} · retains {formatBytes(node.retained)}
          {node.distance !== null ? ` · distance ${node.distance}` : ""}
        </span>
        <span className="flex-1" />
        <button type="button" className={chip(tab === "path")} onClick={() => setTab("path")}>
          Why is it alive?
        </button>
        <button type="button" className={chip(tab === "retainers")} onClick={() => setTab("retainers")}>
          Retainers {retainers.length}
        </button>
        <button type="button" className={chip(tab === "refs")} onClick={() => setTab("refs")}>
          References
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1 text-[12px]">
        {tab === "path" &&
          (path.length ? (
            <div className="px-3">
              <div className="text-muted-foreground">(root)</div>
              {path.map((p, i) => (
                <div key={i} style={{ paddingLeft: (i + 1) * 12 }} className="truncate">
                  <span className="text-muted-foreground">└ </span>
                  <span className="font-mono text-sky-600 dark:text-sky-400">{p.edgeName}</span>
                  <span className="text-muted-foreground"> ({p.edgeType}) → </span>
                  <span className={cn(i === path.length - 1 && "font-semibold")}>{nodeLabel(p.node)}</span>
                  <span className="ml-2 text-[11px] text-muted-foreground">{p.node.class}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-3 text-muted-foreground">Not reachable from the root (only weakly held, or garbage).</div>
          ))}
        {tab === "retainers" &&
          retainers.map((r, i) => (
            <div key={i} className="flex items-center gap-1.5 px-3 py-[1px] hover:bg-muted/30">
              <span className="min-w-0 flex-1 truncate">{nodeLabel(r.node)}</span>
              <span className="text-muted-foreground">.</span>
              <span className={cn("font-mono", r.edgeType === "weak" && "line-through text-muted-foreground")}>{r.edgeName}</span>
              <span className="w-16 text-right text-[11px] text-muted-foreground">d {r.node.distance ?? "–"}</span>
            </div>
          ))}
        {tab === "refs" && <Refs heap={heap} node={node} />}
      </div>
    </div>
  );
}

export const HeapPane = forwardRef<EditorPaneHandle, { path: string }>(function HeapPane({ path }, ref) {
  const [info, setInfo] = useState<HeapInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ClassRow[]>([]);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<"retained" | "shallow" | "count">("retained");
  const [open, setOpen] = useState<Record<number, { total: number; items: NodeRow[] }>>({});
  const [selected, setSelected] = useState<{ heap: number; node: NodeRow } | null>(null);
  const [others, setOthers] = useState<string[]>([]);
  const [compare, setCompare] = useState<{ path: string; info: HeapInfo; rows: DiffRow[] } | null>(null);
  const [view, setView] = useState<"summary" | "compare">("summary");

  useEffect(() => {
    let id: number | null = null;
    setInfo(null);
    invoke<HeapInfo>("heap_open", { path })
      .then(async (i) => {
        id = i.id;
        setInfo(i);
        setRows(await invoke<ClassRow[]>("heap_summary", { id: i.id }));
      })
      .catch((e) => setError(String(e)));
    const dir = path.replace(/\\/g, "/").replace(/\/[^/]*$/, "");
    void native
      .glob({ pattern: "*.heapsnapshot", root: dir, maxResults: 50 })
      .then((r) => setOthers(r.hits.map((h) => h.path.replace(/\\/g, "/")).filter((p) => p !== path.replace(/\\/g, "/"))))
      .catch(() => {});
    return () => {
      if (id !== null) void invoke("heap_close", { id });
    };
  }, [path]);

  const runCompare = async (other: string) => {
    if (!info) return;
    if (compare) void invoke("heap_close", { id: compare.info.id });
    const o = await invoke<HeapInfo>("heap_open", { path: other });
    // Compare in time order: the newer one is whichever has more node ids allocated later; use file order as given.
    const rows = await invoke<DiffRow[]>("heap_diff", { newer: info.id, older: o.id });
    setCompare({ path: other, info: o, rows });
    setView("compare");
  };

  useImperativeHandle(
    ref,
    () =>
      ({
        setQuery: setFilter,
        findNext: () => {},
        findPrevious: () => {},
        clearQuery: () => setFilter(""),
        focus: () => {},
        getSelection: () => null,
        getPath: () => path,
        reload: () => true,
        gotoLine: () => {},
        undo: () => {},
        redo: () => {},
        openFindReplace: () => {},
        toggleBlame: () => {},
        save: async () => {},
      }) as EditorPaneHandle,
    [path],
  );

  const shown = useMemo(() => rows.filter((r) => !filter || r.name.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => b[sort] - a[sort]), [rows, filter, sort]);
  const toggleClass = async (heap: number, cls: number, more = false) => {
    if (open[cls] && !more) {
      setOpen(({ [cls]: _, ...rest }) => rest);
      return;
    }
    const offset = more ? open[cls].items.length : 0;
    const [total, items] = await invoke<[number, NodeRow[]]>("heap_instances", { id: heap, class: cls, offset, limit: 100 });
    setOpen((o) => ({ ...o, [cls]: { total, items: more ? [...o[cls].items, ...items] : items } }));
  };

  if (error) return <div className="p-6 text-[12px] text-destructive">{error}</div>;
  if (!info) return <div className="p-6 text-[12px] text-muted-foreground">Loading the snapshot and computing retained sizes…</div>;
  const th = (k: typeof sort, label: string) => (
    <th className={cn("cursor-pointer px-2 py-1 text-right font-normal hover:text-foreground", sort === k && "text-foreground")} onClick={() => setSort(k)}>
      {label}
      {sort === k ? " ↓" : ""}
    </th>
  );
  const chip = (on: boolean) => cn("rounded px-2 py-0.5 text-[11.5px]", on ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted");
  return (
    <div className="flex h-full flex-col text-[12px]">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <span className="font-medium">{path.split(/[\\/]/).pop()}</span>
        <span className="text-[11px] text-muted-foreground">
          {info.nodes.toLocaleString()} objects · {formatBytes(info.reachableSize)} reachable of {formatBytes(info.totalSize)}
        </span>
        <span className="flex-1" />
        <button type="button" className={chip(view === "summary")} onClick={() => setView("summary")}>
          Summary
        </button>
        {compare && (
          <button type="button" className={chip(view === "compare")} onClick={() => setView("compare")}>
            vs {compare.path.split("/").pop()}
          </button>
        )}
        <select className="max-w-56 rounded border border-border/60 bg-background px-1 py-0.5 text-[11.5px]" value="" onChange={(e) => e.target.value && void runCompare(e.target.value)}>
          <option value="">Compare with an earlier snapshot…</option>
          {others.map((o) => (
            <option key={o} value={o}>
              {o.split("/").pop()}
            </option>
          ))}
        </select>
        <input className="w-44 rounded border border-border/60 bg-background px-2 py-0.5" placeholder="Filter classes" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {view === "summary" ? (
          <table className="w-full">
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="border-b border-border/40 text-left text-[11px] text-muted-foreground">
                <th className="py-1 pl-3 font-normal">Class</th>
                {th("count", "Objects")}
                {th("shallow", "Shallow size")}
                {th("retained", "Retained size")}
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 1000).map((r) => (
                <ClassRows key={r.class} r={r} total={info.reachableSize} open={open[r.class]} onToggle={(more) => void toggleClass(info.id, r.class, more)} selected={selected?.node.index} onSelect={(node) => setSelected({ heap: info.id, node })} />
              ))}
            </tbody>
          </table>
        ) : (
          compare && (
            <table className="w-full">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b border-border/40 text-right text-[11px] text-muted-foreground">
                  <th className="py-1 pl-3 text-left font-normal">Class</th>
                  <th className="px-2 font-normal"># New</th>
                  <th className="px-2 font-normal"># Deleted</th>
                  <th className="px-2 font-normal"># Delta</th>
                  <th className="px-2 font-normal">Alloc. size</th>
                  <th className="px-2 font-normal">Freed size</th>
                  <th className="px-3 font-normal">Size delta</th>
                </tr>
              </thead>
              <tbody>
                {compare.rows
                  .filter((r) => !filter || r.name.toLowerCase().includes(filter.toLowerCase()))
                  .slice(0, 1000)
                  .map((r) => (
                    <DiffRows key={r.name} r={r} newer={info.id} older={compare.info.id} selected={selected?.node.index} onSelect={(node) => setSelected({ heap: info.id, node })} />
                  ))}
              </tbody>
            </table>
          )
        )}
      </div>
      {selected && (
        <div className="h-[38%] shrink-0 border-t border-border/60">
          <Details heap={selected.heap} node={selected.node} />
        </div>
      )}
    </div>
  );
});

function ClassRows({ r, total, open, onToggle, selected, onSelect }: { r: ClassRow; total: number; open?: { total: number; items: NodeRow[] }; onToggle: (more: boolean) => void; selected?: number; onSelect: (n: NodeRow) => void }) {
  return (
    <>
      <tr className="cursor-pointer border-b border-border/20 hover:bg-muted/30" onClick={() => onToggle(false)}>
        <td className="py-0.5 pl-3">
          <span className="mr-1 inline-block w-3 text-[10px] text-muted-foreground">{open ? "▾" : "▸"}</span>
          <span className={cn(!r.name.startsWith("(") && "font-medium")}>{r.name}</span>
        </td>
        <td className="px-2 text-right tabular-nums">{r.count.toLocaleString()}</td>
        <td className="px-2 text-right tabular-nums">{formatBytes(r.shallow)}</td>
        <td className="px-2 text-right tabular-nums">
          {formatBytes(r.retained)} <span className="text-[10.5px] text-muted-foreground">{total ? `${((r.retained / total) * 100).toFixed(1)}%` : ""}</span>
        </td>
      </tr>
      {open?.items.map((n) => (
        <tr key={n.index} className={cn("cursor-pointer border-b border-border/10 text-[11.5px] hover:bg-muted/30", selected === n.index && "bg-primary/10")} onClick={() => onSelect(n)}>
          <td className="max-w-0 truncate py-0.5 pl-9">{nodeLabel(n)}</td>
          <td className="px-2 text-right text-muted-foreground">d {n.distance ?? "–"}</td>
          <td className="px-2 text-right tabular-nums">{formatBytes(n.shallow)}</td>
          <td className="px-2 text-right tabular-nums">{formatBytes(n.retained)}</td>
        </tr>
      ))}
      {open && open.items.length < open.total && (
        <tr>
          <td colSpan={4} className="py-0.5 pl-9">
            <button type="button" className="text-[11.5px] text-primary hover:underline" onClick={() => onToggle(true)}>
              Show more ({(open.total - open.items.length).toLocaleString()} left)
            </button>
          </td>
        </tr>
      )}
    </>
  );
}

function DiffRows({ r, newer, older, selected, onSelect }: { r: DiffRow; newer: number; older: number; selected?: number; onSelect: (n: NodeRow) => void }) {
  const [items, setItems] = useState<NodeRow[] | null>(null);
  const delta = r.added - r.removed;
  const sizeDelta = r.addedSize - r.removedSize;
  return (
    <>
      <tr
        className={cn("border-b border-border/20 text-right tabular-nums hover:bg-muted/30", r.class !== null && r.added > 0 && "cursor-pointer")}
        onClick={() => {
          if (items) setItems(null);
          else if (r.class !== null && r.added > 0) void invoke<NodeRow[]>("heap_new_instances", { newer, older, class: r.class }).then(setItems);
        }}
      >
        <td className="py-0.5 pl-3 text-left">
          <span className="mr-1 inline-block w-3 text-[10px] text-muted-foreground">{r.class !== null && r.added > 0 ? (items ? "▾" : "▸") : ""}</span>
          <span className={cn(!r.name.startsWith("(") && "font-medium")}>{r.name}</span>
        </td>
        <td className="px-2">{r.added ? `+${r.added.toLocaleString()}` : ""}</td>
        <td className="px-2">{r.removed ? `−${r.removed.toLocaleString()}` : ""}</td>
        <td className={cn("px-2", delta > 0 ? "text-red-500" : delta < 0 ? "text-emerald-600" : "")}>{delta > 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString()}</td>
        <td className="px-2">{formatBytes(r.addedSize)}</td>
        <td className="px-2">{formatBytes(r.removedSize)}</td>
        <td className={cn("px-3", sizeDelta > 0 ? "text-red-500" : sizeDelta < 0 ? "text-emerald-600" : "")}>{sizeDelta > 0 ? "+" : ""}{formatBytes(sizeDelta)}</td>
      </tr>
      {items?.map((n) => (
        <tr key={n.index} className={cn("cursor-pointer border-b border-border/10 text-[11.5px] hover:bg-muted/30", selected === n.index && "bg-primary/10")} onClick={() => onSelect(n)}>
          <td colSpan={5} className="max-w-0 truncate py-0.5 pl-9">
            {nodeLabel(n)}
          </td>
          <td className="px-2 text-right tabular-nums">{formatBytes(n.shallow)}</td>
          <td className="px-3 text-right tabular-nums">{formatBytes(n.retained)}</td>
        </tr>
      ))}
    </>
  );
}
