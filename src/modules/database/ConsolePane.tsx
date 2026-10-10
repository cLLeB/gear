// A SQL console tab: editor with schema-aware completion (Ctrl+Enter runs the
// statement at the cursor or the selection, Shift+Ctrl+Enter runs all), a
// virtualized results grid, inline editing for single-table queries (applied
// as one reviewed transaction), export and history.

import { MySQL, PostgreSQL, SQLite, sql as sqlLang } from "@codemirror/lang-sql";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { buildSharedExtensions } from "@/modules/editor/lib/extensions";
import { EDITOR_THEME_EXT } from "@/modules/editor/lib/themes";
import { confirmPick, quickPick } from "@/modules/quick-pick";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { writeTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";
import { dangerReason, editableTable, editStatements, qualified, splitStatements, statementAt, toCsv, toJson, type RowEdit } from "./model";
import { connect, parseConsolePath, profileById, runBatch, runQuery, useDbStore, type QueryResult } from "./store";

const SHARED = buildSharedExtensions();
const ROW_H = 24;

interface Grid {
  sql: string;
  result: QueryResult;
  /** Editing target when the query reads one table with known columns. */
  table: { schema: string | null; name: string } | null;
}

function Cell({ value, edited, onEdit, editable }: { value: string | null; edited: boolean; editable: boolean; onEdit: (v: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <input
        autoFocus
        className="h-full w-full bg-background px-1 font-mono text-[12px] outline outline-1 outline-primary"
        defaultValue={value ?? ""}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            onEdit((e.target as HTMLInputElement).value);
            setEditing(false);
          } else if (e.key === "Escape") setEditing(false);
          else if (e.key === "Delete" && e.ctrlKey) {
            onEdit(null);
            setEditing(false);
          }
        }}
        onBlur={(e) => {
          if (e.target.value !== (value ?? "")) onEdit(e.target.value);
          setEditing(false);
        }}
      />
    );
  return (
    <div className={cn("h-full truncate px-1.5 font-mono text-[12px] leading-[24px]", value === null && "italic text-muted-foreground/60", edited && "bg-amber-500/20")} title={value ?? "NULL"} onDoubleClick={() => editable && setEditing(true)}>
      {value === null ? "NULL" : value}
    </div>
  );
}

function ResultGrid({ grid, profileId, onReload }: { grid: Grid; profileId: string; onReload: () => void }) {
  const { result } = grid;
  const schema = useDbStore((s) => s.schema[profileId]);
  const tableInfo = grid.table ? schema?.find((t) => t.name === grid.table!.name && (!grid.table!.schema || t.schema === grid.table!.schema)) : undefined;
  const editable = !!tableInfo && tableInfo.kind === "table" && result.columns.every((c) => tableInfo.columns.some((x) => x.name === c));
  const [rows, setRows] = useState(result.rows);
  const [edits, setEdits] = useState<Map<number, (string | null)[]>>(new Map());
  const [deleted, setDeleted] = useState<Set<number>>(new Set());
  const [inserted, setInserted] = useState<(string | null)[][]>([]);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(400);
  const [sort, setSort] = useState<{ col: number; desc: boolean } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setRows(result.rows);
    setEdits(new Map());
    setDeleted(new Set());
    setInserted([]);
    setSort(null);
  }, [result]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const order = useMemo(() => {
    const idx = rows.map((_, i) => i);
    if (!sort) return idx;
    const num = rows.every((r) => r[sort.col] === null || r[sort.col] === "" || !Number.isNaN(Number(r[sort.col])));
    return idx.sort((a, b) => {
      const x = rows[a][sort.col];
      const y = rows[b][sort.col];
      const c = x === null ? 1 : y === null ? -1 : num ? Number(x) - Number(y) : x.localeCompare(y);
      return sort.desc ? -c : c;
    });
  }, [rows, sort]);
  const widths = useMemo(() => result.columns.map((c, i) => Math.min(360, Math.max(70, c.length * 8 + 24, ...rows.slice(0, 200).map((r) => Math.min(48, (r[i] ?? "NULL").length) * 7.4 + 16)))), [result.columns, rows]);
  const pending = edits.size + deleted.size + inserted.length;
  const first = Math.max(0, Math.floor(scroll / ROW_H) - 10);
  const last = Math.min(order.length, first + Math.ceil(height / ROW_H) + 20);

  const apply = async () => {
    if (!tableInfo || !grid.table) return;
    const p = profileById(profileId);
    const changes: RowEdit[] = [
      ...[...edits].filter(([i]) => !deleted.has(i)).map(([i, values]) => ({ kind: "update" as const, original: rows[i], values })),
      ...[...deleted].map((i) => ({ kind: "delete" as const, original: rows[i] })),
      ...inserted.map((values) => ({ kind: "insert" as const, values })),
    ];
    const stmts = editStatements({ schema: tableInfo.schema, name: tableInfo.name }, tableInfo.columns.map((c) => ({ name: c.name, primaryKey: c.primaryKey })), result.columns, changes, p?.kind ?? "postgres");
    if (!stmts.length) return;
    const ok = await confirmPick(`Apply ${stmts.length} change(s) to ${tableInfo.name} in one transaction?`, "Apply", stmts.slice(0, 12).join(";\n") + (stmts.length > 12 ? `;\n… ${stmts.length - 12} more` : ";"));
    if (!ok) return;
    try {
      const n = await runBatch(profileId, stmts);
      toast.success(`${n} row(s) changed`);
      onReload();
    } catch (e) {
      toast.error("Changes rolled back", { description: String(e) });
    }
  };

  const exportAs = async (fmt: "csv" | "json" | "md") => {
    const data = order.map((i) => rows[i]);
    const text = fmt === "csv" ? toCsv(result.columns, data) : fmt === "json" ? toJson(result.columns, data) : [`| ${result.columns.join(" | ")} |`, `| ${result.columns.map(() => "---").join(" | ")} |`, ...data.map((r) => `| ${r.map((v) => (v ?? "NULL").replace(/\|/g, "\\|")).join(" | ")} |`)].join("\n");
    await writeTerminalClipboard(text);
    toast.success(`Copied ${data.length} row(s) as ${fmt.toUpperCase()}`);
  };

  const totalW = widths.reduce((a, b) => a + b, 48);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/60 px-2 text-[11.5px] text-muted-foreground">
        {result.columns.length ? (
          <span>
            {result.rows.length.toLocaleString()} row(s){result.truncated ? " (truncated — add LIMIT/OFFSET to page)" : ""} · {result.elapsedMs} ms
          </span>
        ) : (
          <span>
            {result.affected ?? 0} row(s) affected · {result.elapsedMs} ms
          </span>
        )}
        {editable ? <span className="rounded bg-sky-500/15 px-1.5 text-sky-700 dark:text-sky-300">editable · double-click a cell</span> : grid.table && result.columns.length ? <span title="Editing needs a plain SELECT from one table (not a view) with all selected columns from it">read-only</span> : null}
        <div className="ml-auto flex items-center gap-1">
          {editable ? (
            <>
              <button type="button" className="rounded px-1.5 py-0.5 hover:bg-muted" onClick={() => setInserted((r) => [...r, result.columns.map(() => null)])}>
                + Row
              </button>
              <button type="button" className="rounded px-1.5 py-0.5 hover:bg-muted disabled:opacity-40" disabled={selected === null} onClick={() => selected !== null && setDeleted((d) => new Set(d).add(selected))}>
                − Row
              </button>
              {pending ? (
                <>
                  <button type="button" className="rounded bg-primary px-2 py-0.5 text-primary-foreground" onClick={() => void apply()}>
                    Apply {pending}
                  </button>
                  <button
                    type="button"
                    className="rounded px-1.5 py-0.5 hover:bg-muted"
                    onClick={() => {
                      setEdits(new Map());
                      setDeleted(new Set());
                      setInserted([]);
                    }}
                  >
                    Discard
                  </button>
                </>
              ) : null}
            </>
          ) : null}
          {result.columns.length ? (
            <>
              <button type="button" className="rounded px-1.5 py-0.5 hover:bg-muted" onClick={() => void exportAs("csv")}>
                CSV
              </button>
              <button type="button" className="rounded px-1.5 py-0.5 hover:bg-muted" onClick={() => void exportAs("json")}>
                JSON
              </button>
              <button type="button" className="rounded px-1.5 py-0.5 hover:bg-muted" onClick={() => void exportAs("md")}>
                MD
              </button>
            </>
          ) : null}
        </div>
      </div>
      {result.columns.length ? (
        <div ref={box} className="min-h-0 flex-1 overflow-auto" onScroll={(e) => setScroll((e.target as HTMLDivElement).scrollTop)}>
          <div style={{ width: totalW, minWidth: "100%" }}>
            <div className="sticky top-0 z-10 flex border-b bg-muted/80 backdrop-blur" style={{ height: ROW_H }}>
              <div className="w-12 shrink-0" />
              {result.columns.map((c, i) => {
                const col = tableInfo?.columns.find((x) => x.name === c);
                return (
                  <button
                    key={`${c}${i}`}
                    type="button"
                    className="truncate border-l border-border/40 px-1.5 text-left text-[11.5px] font-medium"
                    style={{ width: widths[i] }}
                    title={col ? `${c} · ${col.dataType}${col.primaryKey ? " · primary key" : ""}${col.nullable ? "" : " · not null"}` : c}
                    onClick={() => setSort((s) => (s?.col === i ? (s.desc ? null : { col: i, desc: true }) : { col: i, desc: false }))}
                  >
                    {col?.primaryKey ? "🔑 " : ""}
                    {c}
                    {sort?.col === i ? (sort.desc ? " ↓" : " ↑") : ""}
                  </button>
                );
              })}
            </div>
            <div style={{ height: (order.length + inserted.length) * ROW_H, position: "relative" }}>
              {order.slice(first, last).map((ri, k) => {
                const vals = edits.get(ri) ?? rows[ri];
                return (
                  <div key={ri} className={cn("absolute left-0 flex border-b border-border/30", selected === ri && "bg-primary/10", deleted.has(ri) && "line-through opacity-40")} style={{ top: (first + k) * ROW_H, height: ROW_H }} onClick={() => setSelected(ri)}>
                    <div className="w-12 shrink-0 pr-1.5 text-right text-[10.5px] leading-[24px] text-muted-foreground">{first + k + 1}</div>
                    {vals.map((v, ci) => (
                      <div key={ci} className="border-l border-border/30" style={{ width: widths[ci] }}>
                        <Cell
                          value={v}
                          editable={editable && !deleted.has(ri)}
                          edited={!!edits.get(ri) && edits.get(ri)![ci] !== rows[ri][ci]}
                          onEdit={(nv) =>
                            setEdits((m) => {
                              const next = new Map(m);
                              const cur = [...(m.get(ri) ?? rows[ri])];
                              cur[ci] = nv;
                              next.set(ri, cur);
                              return next;
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                );
              })}
              {inserted.map((vals, k) => (
                <div key={`new${k}`} className="absolute left-0 flex border-b border-border/30 bg-green-500/10" style={{ top: (order.length + k) * ROW_H, height: ROW_H }}>
                  <div className="w-12 shrink-0 pr-1.5 text-right text-[10.5px] leading-[24px] text-green-600">new</div>
                  {vals.map((v, ci) => (
                    <div key={ci} className="border-l border-border/30" style={{ width: widths[ci] }}>
                      <Cell value={v} editable edited={false} onEdit={(nv) => setInserted((all) => all.map((r, j) => (j === k ? r.map((x, c) => (c === ci ? nv : x)) : r)))} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="p-3 text-[12px] text-muted-foreground">Statement executed.</div>
      )}
    </div>
  );
}

export const ConsolePane = forwardRef<EditorPaneHandle, { path: string }>(function ConsolePane({ path }, ref) {
  const parsed = parseConsolePath(path);
  const profileId = parsed?.profileId ?? "";
  const profile = useDbStore((s) => s.profiles.find((p) => p.id === profileId));
  const schema = useDbStore((s) => s.schema[profileId]);
  const live = useDbStore((s) => !!s.live[profileId]);
  const editorThemeId = usePreferencesStore((s) => s.editorTheme);
  const themeExt = EDITOR_THEME_EXT[editorThemeId] ?? EDITOR_THEME_EXT.atomone;
  const cm = useRef<ReactCodeMirrorRef>(null);
  const initial = useMemo(() => {
    if (!parsed?.table || !profile) return "";
    return `SELECT * FROM ${qualified(parsed.table.schema, parsed.table.name, profile.kind)}\nLIMIT 200;\n`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, profile?.kind]);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [split, setSplit] = useState(0.38);
  const lastSql = useRef<string>("");

  const exec = useCallback(
    async (sql: string) => {
      if (!sql.trim() || !profile) return;
      const statements = splitStatements(sql, profile.kind);
      for (const s of statements) {
        const why = dangerReason(s.text);
        if (why && !(await confirmPick(`${why}. Run it anyway?`, "Run", s.text.slice(0, 400)))) return;
        if (profile.readOnly && !/^\s*(select|with|show|explain|describe|pragma|values)\b/i.test(s.text) && !(await confirmPick(`"${profile.name}" is marked read-only. Run this write anyway?`, "Run", s.text.slice(0, 400)))) return;
      }
      setRunning(true);
      setError(null);
      lastSql.current = sql;
      try {
        const result = await runQuery(profileId, sql);
        const last = statements[statements.length - 1]?.text ?? sql;
        setGrid({ sql: last, result, table: statements.length === 1 ? editableTable(last) : null });
      } catch (e) {
        setError(String(e));
      } finally {
        setRunning(false);
      }
    },
    [profile, profileId],
  );

  const runAtCursor = useCallback(() => {
    const v = cm.current?.view;
    if (!v || !profile) return true;
    const sel = v.state.selection.main;
    const text = v.state.doc.toString();
    void exec(sel.empty ? (statementAt(text, sel.head, profile.kind)?.text ?? "") : v.state.sliceDoc(sel.from, sel.to));
    return true;
  }, [exec, profile]);

  const runAll = useCallback(() => {
    void exec(cm.current?.view?.state.doc.toString() ?? "");
    return true;
  }, [exec]);

  // Run a table's preview query (or SQL sent from a .sql file) as soon as the tab opens.
  useEffect(() => {
    if (!profile) return;
    void connect(profileId).catch((e) => setError(String(e)));
    let pending: { id: string; sql: string } | null = null;
    try {
      pending = JSON.parse(sessionStorage.getItem("gear-db-pending") ?? "null");
    } catch {
      /* ignore */
    }
    if (pending?.id === profileId && !initial) {
      sessionStorage.removeItem("gear-db-pending");
      const sql = pending.sql;
      setTimeout(() => {
        const v = cm.current?.view;
        if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: sql } });
        void exec(sql);
      }, 50);
      return;
    }
    if (initial) void exec(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, !!profile]);

  const dialect = profile?.kind === "mysql" ? MySQL : profile?.kind === "sqlite" ? SQLite : PostgreSQL;
  const completionSchema = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const t of schema ?? []) {
      out[t.name] = t.columns.map((c) => c.name);
      if (t.schema && t.schema !== "public" && t.schema !== "main") out[`${t.schema}.${t.name}`] = t.columns.map((c) => c.name);
    }
    return out;
  }, [schema]);
  const runRef = useRef({ runAtCursor, runAll });
  runRef.current = { runAtCursor, runAll };
  const extensions = useMemo(
    () => [
      ...SHARED,
      sqlLang({ dialect, schema: completionSchema, upperCaseKeywords: true }),
      Prec.highest(
        keymap.of([
          { key: "Mod-Enter", run: () => runRef.current.runAtCursor() },
          { key: "Shift-Mod-Enter", run: () => runRef.current.runAll() },
          { key: "F5", run: () => runRef.current.runAll() },
        ]),
      ),
      EditorView.theme({ "&": { fontSize: "13px" } }),
    ],
    [dialect, completionSchema],
  );

  useImperativeHandle(
    ref,
    () => ({
      setQuery: () => {},
      findNext: () => {},
      findPrevious: () => {},
      clearQuery: () => {},
      focus: () => cm.current?.view?.focus(),
      getSelection: () => {
        const v = cm.current?.view;
        if (!v) return null;
        const s = v.state.selection.main;
        return s.empty ? null : v.state.sliceDoc(s.from, s.to);
      },
      getPath: () => path,
      reload: () => {
        if (lastSql.current) void exec(lastSql.current);
        return true;
      },
      gotoLine: () => {},
      undo: () => {},
      redo: () => {},
      openFindReplace: () => {},
      toggleBlame: () => {},
      save: async () => {},
    }),
    [exec, path],
  );

  if (!profile) return <div className="flex h-full items-center justify-center p-6 text-[12px] text-muted-foreground">This connection was removed. Add it again in the Database view.</div>;
  const history = useDbStore.getState().history.filter((h) => h.profileId === profileId);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/60 px-2 text-[11.5px]">
        <span className={cn("size-2 rounded-full", live ? "bg-green-500" : "bg-muted-foreground/40")} />
        <span className="font-medium">{profile.name}</span>
        <span className="text-muted-foreground">{profile.kind === "sqlite" ? profile.path?.replace(/^.*[\\/]/, "") : `${profile.user ?? ""}@${profile.host ?? "localhost"}/${profile.database ?? ""}`}</span>
        {profile.readOnly ? <span className="rounded bg-amber-500/15 px-1 text-amber-700 dark:text-amber-300">read-only</span> : null}
        <span className="mx-1 h-4 w-px bg-border" />
        <button type="button" className="rounded px-2 py-0.5 text-green-600 hover:bg-muted disabled:opacity-40 dark:text-green-400" disabled={running} onClick={runAtCursor} title="Run the statement at the cursor or the selection (Ctrl+Enter)">
          ▶ Run
        </button>
        <button type="button" className="rounded px-2 py-0.5 hover:bg-muted disabled:opacity-40" disabled={running} onClick={runAll} title="Run the whole script (Ctrl+Shift+Enter)">
          ⏩ All
        </button>
        <button
          type="button"
          className="rounded px-2 py-0.5 hover:bg-muted"
          onClick={async () => {
            const pick = await quickPick(history.map((h) => ({ label: h.sql.replace(/\s+/g, " ").slice(0, 140), description: new Date(h.at).toLocaleString(), value: h.sql })), { title: "Query history", emptyText: "No queries yet" });
            const v = cm.current?.view;
            if (pick && v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: pick } });
          }}
        >
          History
        </button>
        <button
          type="button"
          className="rounded px-2 py-0.5 hover:bg-muted"
          title="Show the query plan"
          onClick={() => {
            const v = cm.current?.view;
            if (!v) return;
            const s = statementAt(v.state.doc.toString(), v.state.selection.main.head, profile.kind)?.text;
            if (s) void exec(`${profile.kind === "sqlite" ? "EXPLAIN QUERY PLAN" : profile.kind === "postgres" ? "EXPLAIN (ANALYZE false, COSTS true, VERBOSE false)" : "EXPLAIN"} ${s}`);
          }}
        >
          Explain
        </button>
        {running ? <span className="ml-2 animate-pulse text-muted-foreground">running…</span> : null}
      </div>
      <div className="min-h-0 overflow-hidden border-b border-border/60" style={{ flex: `0 0 ${split * 100}%` }}>
        <CodeMirror ref={cm} value={initial} theme={themeExt} extensions={extensions} height="100%" className="h-full" basicSetup={{ lineNumbers: true, foldGutter: false }} />
      </div>
      <div
        className="h-1 shrink-0 cursor-row-resize bg-border/40 hover:bg-primary/40"
        onMouseDown={(e) => {
          const startY = e.clientY;
          const start = split;
          const total = (e.currentTarget.parentElement as HTMLElement).clientHeight;
          const move = (m: MouseEvent) => setSplit(Math.min(0.85, Math.max(0.12, start + (m.clientY - startY) / total)));
          const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
          };
          window.addEventListener("mousemove", move);
          window.addEventListener("mouseup", up);
        }}
      />
      <div className="min-h-0 flex-1">
        {error ? (
          <pre className="m-2 whitespace-pre-wrap rounded bg-red-500/10 p-2 font-mono text-[12px] text-red-700 dark:text-red-300">{error}</pre>
        ) : grid ? (
          <ResultGrid grid={grid} profileId={profileId} onReload={() => void exec(grid.sql)} />
        ) : (
          <div className="p-3 text-[12px] text-muted-foreground">Ctrl+Enter runs the statement under the cursor (or the selection); Ctrl+Shift+Enter runs everything. Table and column names complete from the schema.</div>
        )}
      </div>
    </div>
  );
});
