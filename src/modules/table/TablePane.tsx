// gear-table://<file>: a CSV / TSV file as a grid — sort, filter, edit cells,
// add and remove rows and columns, then save in the file's own dialect.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { app, frontFilePath } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { quickPick } from "@/modules/quick-pick";
import { toolPaneHandle } from "@/modules/tools/paneHandle";
import { columnLetter, columnStats, deleteColumn, deleteRow, delimiterName, filterRows, insertColumn, insertRow, moveColumn, normalize, parseCsv, serializeCsv, setCell, sortOrder, toMarkdown, type Dialect, type SortDir } from "./model";

const SCHEME = "gear-table://";
const ROW_H = 24;

export function openTableFor(file: string): void {
  app().openFile(`${SCHEME}${file}`);
}

export function openTableForActive(): void {
  const file = frontFilePath() ?? getActiveEditor()?.path ?? null;
  if (!file || !/\.(csv|tsv|psv|tab)$/i.test(file)) return void toast.info("Open a .csv or .tsv file first.");
  openTableFor(file);
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";

export const TablePane = forwardRef<EditorPaneHandle, { path: string; onDirtyChange?: (dirty: boolean) => void }>(function TablePane({ path, onDirtyChange }, ref) {
  const file = path.slice(SCHEME.length);
  const [rows, setRows] = useState<string[][] | null>(null);
  const [dialect, setDialect] = useState<Dialect>({ delimiter: ",", eol: "\n", finalNewline: true });
  const [error, setError] = useState<string | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ column: number; dir: SortDir } | null>(null);
  const [sel, setSel] = useState<{ row: number; column: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [history, setHistory] = useState<string[][][]>([]);
  const [future, setFuture] = useState<string[][][]>([]);
  const [savedAt, setSavedAt] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const scroller = useRef<HTMLDivElement>(null);

  const dirty = history.length !== savedAt;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const load = useCallback(async () => {
    const r = await native.readFile(file).catch((e) => ({ kind: "error" as const, message: String(e) }));
    if (r.kind !== "text") return void setError(r.kind === "error" ? r.message : r.kind === "toolarge" ? "This file is too large to open as a table." : "This file is not text.");
    const t = parseCsv(r.content, undefined, file);
    setRows(normalize(t.rows));
    setDialect(t.dialect);
    setHistory([]);
    setFuture([]);
    setSavedAt(0);
    setError(null);
  }, [file]);

  useEffect(() => void load(), [load]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setHeight(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows === null]);

  const change = useCallback(
    (next: string[][]) => {
      if (!rows || next === rows) return;
      if (savedAt > history.length) setSavedAt(-1);
      setHistory([...history, rows]);
      setFuture([]);
      setRows(next);
    },
    [rows, history, savedAt],
  );

  const undo = useCallback(() => {
    if (!rows || !history.length) return;
    setFuture([...future, rows]);
    setRows(history[history.length - 1]);
    setHistory(history.slice(0, -1));
  }, [rows, history, future]);

  const redo = useCallback(() => {
    if (!rows || !future.length) return;
    setHistory([...history, rows]);
    setRows(future[future.length - 1]);
    setFuture(future.slice(0, -1));
  }, [rows, history, future]);

  const save = useCallback(async () => {
    if (!rows || !dirty) return;
    try {
      await native.writeFile(file, serializeCsv({ rows, dialect }), "user");
      setSavedAt(history.length);
      toast.success("Saved");
    } catch (err) {
      toast.error(`Could not save: ${String(err)}`);
    }
  }, [rows, dirty, file, dialect, history.length]);

  // The handle keeps its identity; it reads the current callbacks through a ref.
  const live = useRef({ dirty, load, undo, redo, save });
  live.current = { dirty, load, undo, redo, save };
  useImperativeHandle(
    ref,
    () =>
      toolPaneHandle(path, {
        setQuery,
        clearQuery: () => setQuery(""),
        reload: () => (live.current.dirty ? false : (void live.current.load(), true)),
        undo: () => live.current.undo(),
        redo: () => live.current.redo(),
        save: () => live.current.save(),
        focus: () => scroller.current?.focus(),
      }),
    [path],
  );

  const header = useMemo(() => {
    if (!rows?.length) return [];
    return hasHeader ? rows[0].map((h, i) => h || columnLetter(i)) : rows[0].map((_, i) => columnLetter(i));
  }, [rows, hasHeader]);
  const offset = hasHeader ? 1 : 0;
  const body = useMemo(() => (rows ? rows.slice(offset) : []), [rows, offset]);
  /** Indexes into `body`, in display order. */
  const order = useMemo(() => {
    const kept = new Set(filterRows(body, header, query));
    const sorted = sort ? sortOrder(body, sort.column, sort.dir) : body.map((_, i) => i);
    return sorted.filter((i) => kept.has(i));
  }, [body, header, query, sort]);
  const stats = useMemo(() => (sel && rows ? columnStats(order.map((i) => body[i]), sel.column) : null), [sel, rows, order, body]);

  if (error) return <div className="p-6 text-[12.5px] text-red-500">{error}</div>;
  if (!rows) return <div className="p-6 text-[12.5px] text-muted-foreground">Reading the file…</div>;

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 5);
  const last = Math.min(order.length, first + Math.ceil(height / ROW_H) + 10);
  const selRow = sel ? order.indexOf(sel.row) : -1;
  const commitEdit = () => {
    if (sel && editing !== null) change(setCell(rows, sel.row + offset, sel.column, editing));
    setEditing(null);
  };
  const move = (dRow: number, dCol: number) => {
    if (!sel || !order.length) return;
    const at = Math.max(0, Math.min(order.length - 1, (selRow < 0 ? 0 : selRow) + dRow));
    const column = Math.max(0, Math.min(header.length - 1, sel.column + dCol));
    setSel({ row: order[at], column });
    const el = scroller.current;
    if (el) {
      const top = at * ROW_H;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + ROW_H * 2 > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H * 2 - el.clientHeight;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing !== null) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") return void (e.preventDefault(), void save());
    if (mod && e.key.toLowerCase() === "z") return void (e.preventDefault(), e.shiftKey ? redo() : undo());
    if (mod && e.key.toLowerCase() === "y") return void (e.preventDefault(), redo());
    if (!sel) return;
    if (mod && e.key.toLowerCase() === "c") return void (e.preventDefault(), void navigator.clipboard.writeText(body[sel.row]?.[sel.column] ?? ""));
    if (mod) return;
    const nav: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Tab: [0, e.shiftKey ? -1 : 1] };
    if (e.key in nav) return void (e.preventDefault(), move(...nav[e.key]));
    if (e.key === "Enter" || e.key === "F2") return void (e.preventDefault(), setEditing(body[sel.row]?.[sel.column] ?? ""));
    if (e.key === "Delete" || e.key === "Backspace") return void (e.preventDefault(), change(setCell(rows, sel.row + offset, sel.column, "")));
    if (e.key.length === 1) (e.preventDefault(), setEditing(e.key));
  };

  const columnMenu = async (c: number) => {
    const pick = await quickPick(
      [
        { label: "Sort ascending", value: () => setSort({ column: c, dir: "asc" }) },
        { label: "Sort descending", value: () => setSort({ column: c, dir: "desc" }) },
        ...(sort ? [{ label: "Clear sorting", value: () => setSort(null) }] : []),
        { label: "Insert a column to the left", value: () => change(insertColumn(rows, c, hasHeader ? "new" : "")) },
        { label: "Insert a column to the right", value: () => change(insertColumn(rows, c + 1, hasHeader ? "new" : "")) },
        ...(c > 0 ? [{ label: "Move column left", value: () => change(moveColumn(rows, c, c - 1)) }] : []),
        ...(c < header.length - 1 ? [{ label: "Move column right", value: () => change(moveColumn(rows, c, c + 1)) }] : []),
        { label: "Delete this column", value: () => (change(deleteColumn(rows, c)), setSel(null)) },
        { label: "Copy this column", value: () => void navigator.clipboard.writeText(order.map((i) => body[i][c] ?? "").join("\n")) },
      ],
      { title: `Column ${header[c]}` },
    );
    pick?.();
  };

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 p-2">
        <span className="min-w-0 max-w-[30%] truncate font-mono text-[12px] text-muted-foreground" title={file}>
          {file}
        </span>
        <span className="text-muted-foreground">
          {order.length === body.length ? `${body.length.toLocaleString()} rows` : `${order.length.toLocaleString()} of ${body.length.toLocaleString()} rows`} · {header.length} columns · {delimiterName(dialect.delimiter)}
          {dirty && <span className="ml-1 text-amber-600">● unsaved</span>}
        </span>
        <span className="flex-1" />
        <input className="w-[230px] rounded border border-border/60 bg-background px-2 py-0.5 text-[12px] outline-none focus:border-ring" value={query} placeholder="Filter: words, name:ada, age>30" onChange={(e) => setQuery(e.target.value)} />
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={hasHeader} onChange={(e) => (setHasHeader(e.target.checked), setSel(null), setSort(null))} />
          Header row
        </label>
        <button type="button" className={btn} onClick={() => (change(insertRow(rows, sel ? sel.row + offset + 1 : rows.length)), setSort(null))}>
          + Row
        </button>
        <button type="button" className={btn} disabled={!sel} onClick={() => sel && (change(deleteRow(rows, sel.row + offset)), setSel(null))}>
          − Row
        </button>
        <button type="button" className={btn} onClick={() => change(insertColumn(rows.length ? rows : [[]], header.length, hasHeader ? "new" : ""))}>
          + Column
        </button>
        <button type="button" className={btn} title="Copy what is shown as a Markdown table" onClick={() => void navigator.clipboard.writeText(toMarkdown(header, order.map((i) => body[i]))).then(() => toast.success("Markdown table copied"))}>
          Copy as Markdown
        </button>
        <button type="button" className={btn} disabled={!history.length} onClick={undo}>
          Undo
        </button>
        <button type="button" className={cn(btn, dirty && "bg-primary/10")} disabled={!dirty} onClick={() => void save()}>
          Save
        </button>
        <button type="button" className={btn} onClick={() => app().openFile(file)}>
          Open as text
        </button>
      </div>
      <div ref={scroller} tabIndex={0} data-table-grid className="min-h-0 flex-1 overflow-auto outline-none" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} onKeyDown={onKeyDown}>
        {rows.length === 0 ? (
          <div className="p-6 text-muted-foreground">This file is empty. Use “+ Column” and “+ Row” to start a table.</div>
        ) : (
          <table className="border-separate border-spacing-0" style={{ tableLayout: "fixed" }}>
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 w-[52px] border-b border-r border-border/60 bg-muted px-1 text-right text-[11px] font-normal text-muted-foreground" style={{ height: ROW_H }}>
                  #
                </th>
                {header.map((h, c) => (
                  <th key={c} className="sticky top-0 z-10 min-w-[120px] max-w-[320px] border-b border-r border-border/60 bg-muted px-0 text-left font-medium" style={{ height: ROW_H }}>
                    <div className="flex items-center">
                      <button type="button" data-col={c} className="min-w-0 flex-1 truncate px-1.5 text-left hover:underline" title="Click to sort" onClick={() => setSort(sort?.column === c ? (sort.dir === "asc" ? { column: c, dir: "desc" } : null) : { column: c, dir: "asc" })}>
                        {h}
                        {sort?.column === c && <span className="ml-1 text-muted-foreground">{sort.dir === "asc" ? "▲" : "▼"}</span>}
                      </button>
                      <button type="button" className="px-1 text-muted-foreground hover:text-foreground" title="Column actions" onClick={() => void columnMenu(c)}>
                        ⋯
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {first > 0 && (
                <tr style={{ height: first * ROW_H }}>
                  <td colSpan={header.length + 1} />
                </tr>
              )}
              {order.slice(first, last).map((ri) => (
                <tr key={ri} style={{ height: ROW_H }}>
                  <td className="sticky left-0 z-10 border-b border-r border-border/40 bg-background px-1 text-right text-[11px] tabular-nums text-muted-foreground">{ri + 1}</td>
                  {header.map((_, c) => {
                    const here = sel?.row === ri && sel.column === c;
                    const value = body[ri][c] ?? "";
                    return (
                      <td
                        key={c}
                        data-cell={`${ri}:${c}`}
                        className={cn("max-w-[320px] overflow-hidden border-b border-r border-border/40 px-1.5", here && "outline outline-2 -outline-offset-2 outline-primary", /^[-+]?[\d.,]+%?$/.test(value.trim()) && "text-right tabular-nums")}
                        onMouseDown={() => {
                          if (editing !== null && !here) commitEdit();
                          setSel({ row: ri, column: c });
                        }}
                        onDoubleClick={() => setEditing(value)}
                      >
                        {here && editing !== null ? (
                          <input
                            autoFocus
                            className="w-full bg-background outline-none"
                            value={editing}
                            onChange={(e) => setEditing(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === "Enter") (commitEdit(), move(1, 0), scroller.current?.focus());
                              else if (e.key === "Tab") (e.preventDefault(), commitEdit(), move(0, e.shiftKey ? -1 : 1), scroller.current?.focus());
                              else if (e.key === "Escape") (setEditing(null), scroller.current?.focus());
                            }}
                          />
                        ) : (
                          <div className="truncate whitespace-pre" title={value.length > 30 ? value : undefined}>
                            {value}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {last < order.length && (
                <tr style={{ height: (order.length - last) * ROW_H }}>
                  <td colSpan={header.length + 1} />
                </tr>
              )}
            </tbody>
          </table>
        )}
        {rows.length > 0 && order.length === 0 && <div className="p-4 text-muted-foreground">No rows match the filter.</div>}
      </div>
      <div className="flex min-h-[26px] flex-wrap items-center gap-x-4 gap-y-0.5 border-t border-border/60 px-2 py-1 text-muted-foreground" data-stats>
        {sel && stats ? (
          <>
            <span className="font-medium text-foreground">{header[sel.column]}</span>
            <span>{stats.filled.toLocaleString()} filled</span>
            <span>{stats.empty.toLocaleString()} empty</span>
            <span>{stats.distinct.toLocaleString()} distinct</span>
            {stats.numbers > 0 && stats.sum !== null && stats.mean !== null && (
              <>
                <span>sum {Number(stats.sum.toFixed(6)).toLocaleString()}</span>
                <span>average {Number(stats.mean.toFixed(4)).toLocaleString()}</span>
                <span>
                  min {stats.min?.toLocaleString()} · max {stats.max?.toLocaleString()}
                </span>
              </>
            )}
            {stats.top[0] && stats.top[0][1] > 1 && (
              <span className="truncate">
                most common: {stats.top[0][0]} ({stats.top[0][1]})
              </span>
            )}
          </>
        ) : (
          <span>Click a cell for its column's statistics. Enter or double-click edits; arrows move; Ctrl+S saves.</span>
        )}
      </div>
    </div>
  );
});

export const TABLE_ACTIONS = [{ id: "table.open", label: "Table: Open this CSV / TSV file as a table", keywords: ["csv", "tsv", "table", "grid", "spreadsheet", "sort", "filter", "excel"], run: openTableForActive }];
