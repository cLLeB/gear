// gear-datagen://: design tables of test data (typed columns, ranges,
// enums, patterns, uniqueness, nulls, references between tables), preview
// them, and write JSON, NDJSON, CSV or SQL — the same rows for the same seed.

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { inputBox } from "@/modules/quick-pick";
import { copyToClipboard, toolPaneHandle } from "@/modules/tools/paneHandle";
import { generate, order, tableFromJson, tablesFromSql, toCsv, toJson, toNdjson, toSql, TYPE_LABEL, type Column, type ColumnType, type Dialect, type Row, type Table } from "./model";

export const DATAGEN_PATH = "gear-datagen://Test data";
const KEY = "gear.datagen";

export function openDataGen(): void {
  app().openFile(DATAGEN_PATH);
}

type Format = "json" | "ndjson" | "csv" | "sql";

interface State {
  tables: Table[];
  seed: number;
  format: Format;
  dialect: Dialect;
  create: boolean;
}

const TEMPLATES: Record<string, Table[]> = {
  "Users and orders": [
    {
      name: "users",
      rows: 25,
      columns: [
        { name: "id", type: "id" },
        { name: "name", type: "fullName" },
        { name: "email", type: "email", unique: true },
        { name: "role", type: "enum", values: ["admin:1", "editor:3", "viewer:12"] },
        { name: "active", type: "bool", trueRatio: 0.85 },
        { name: "created_at", type: "datetime", min: "2024-01-01", max: "2026-01-01" },
      ],
    },
    {
      name: "orders",
      rows: 80,
      columns: [
        { name: "id", type: "id", min: 1000 },
        { name: "user_id", type: "ref", ref: "users.id" },
        { name: "number", type: "pattern", pattern: "ORD-####-AA", unique: true },
        { name: "total", type: "price", min: 4, max: 400 },
        { name: "status", type: "enum", values: ["paid:6", "shipped:3", "refunded:1"] },
        { name: "placed_on", type: "date", min: "2025-01-01", max: "2026-01-01" },
      ],
    },
  ],
  "Blog": [
    { name: "authors", rows: 8, columns: [{ name: "id", type: "id" }, { name: "name", type: "fullName" }, { name: "bio", type: "sentence", nullRatio: 0.3 }] },
    { name: "posts", rows: 40, columns: [{ name: "id", type: "id" }, { name: "author_id", type: "ref", ref: "authors.id" }, { name: "title", type: "sentence" }, { name: "body", type: "paragraph" }, { name: "published", type: "bool", trueRatio: 0.7 }] },
    { name: "comments", rows: 150, columns: [{ name: "id", type: "id" }, { name: "post_id", type: "ref", ref: "posts.id" }, { name: "author", type: "username" }, { name: "text", type: "sentence" }] },
  ],
  "Products": [
    { name: "products", rows: 50, columns: [{ name: "sku", type: "pattern", pattern: "AAA-#####", unique: true }, { name: "name", type: "words" }, { name: "price", type: "price", min: 1, max: 999 }, { name: "stock", type: "int", min: 0, max: 500 }, { name: "color", type: "color" }, { name: "category", type: "enum", values: ["tools", "garden", "kitchen", "toys"] }] },
  ],
};

function load(): State {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && Array.isArray(v.tables)) return { seed: 1, format: "json", dialect: "postgres", create: true, ...v };
  } catch {
    // Start from the template.
  }
  return { tables: structuredClone(TEMPLATES["Users and orders"]), seed: 1, format: "json", dialect: "postgres", create: true };
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const field = "rounded border border-border/60 bg-background px-1.5 py-0.5 outline-none focus:border-ring";
const EXT: Record<Format, string> = { json: "json", ndjson: "ndjson", csv: "csv", sql: "sql" };

/** The options a column type takes, as one short text field. */
function optionsText(c: Column): string {
  switch (c.type) {
    case "int":
    case "float":
    case "price":
    case "date":
    case "datetime":
    case "id":
      return [c.min ?? "", c.max ?? ""].join("..").replace(/^\.\.$/, "");
    case "enum":
      return (c.values ?? []).join(", ");
    case "pattern":
      return c.pattern ?? "";
    case "ref":
      return c.ref ?? "";
    case "bool":
      return c.trueRatio !== undefined ? String(c.trueRatio) : "";
    default:
      return "";
  }
}

function applyOptions(c: Column, text: string): Column {
  const t = text.trim();
  const next: Column = { ...c };
  switch (c.type) {
    case "int":
    case "float":
    case "price":
    case "id": {
      const [a, b] = t.split("..");
      next.min = a?.trim() === "" || a === undefined ? undefined : Number(a);
      next.max = b?.trim() === "" || b === undefined ? undefined : Number(b);
      break;
    }
    case "date":
    case "datetime": {
      const [a, b] = t.split("..");
      next.min = a?.trim() || undefined;
      next.max = b?.trim() || undefined;
      break;
    }
    case "enum":
      next.values = t.split(",").map((s) => s.trim()).filter(Boolean);
      break;
    case "pattern":
      next.pattern = text;
      break;
    case "ref":
      next.ref = t;
      break;
    case "bool":
      next.trueRatio = t ? Math.min(1, Math.max(0, Number(t))) : undefined;
      break;
  }
  return next;
}

const PLACEHOLDER: Partial<Record<ColumnType, string>> = { int: "0..1000", float: "0..1", price: "1..500", id: "start at 1", date: "2025-01-01..2025-12-31", datetime: "2025-01-01..2026-01-01", enum: "a, b:3, c", pattern: "AA-####", ref: "table.column", bool: "share true, e.g. 0.8" };

export const DataGenPane = forwardRef<EditorPaneHandle, { path: string }>(function DataGenPane({ path }, ref) {
  const [state, setStateRaw] = useState<State>(load);
  const [active, setActive] = useState(0);
  const live = useRef(state);
  live.current = state;

  const setState = (patch: Partial<State>) => {
    const next = { ...live.current, ...patch };
    setStateRaw(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Not remembered, then.
    }
  };

  useImperativeHandle(ref, () => toolPaneHandle(path), [path]);

  const result = useMemo(() => generate(structuredClone(state.tables), state.seed), [state.tables, state.seed]);
  const table = state.tables[Math.min(active, state.tables.length - 1)];
  const rows: Row[] = table ? (result.tables.get(table.name) ?? []) : [];

  const setTable = (i: number, t: Table) => setState({ tables: state.tables.map((x, j) => (j === i ? t : x)) });
  const setColumn = (ci: number, c: Column) => table && setTable(active, { ...table, columns: table.columns.map((x, j) => (j === ci ? c : x)) });

  /** The whole dataset in the chosen format. */
  const output = (): string => {
    const sorted = order(state.tables).order;
    switch (state.format) {
      case "json":
        return state.tables.length === 1 ? toJson(rows) : JSON.stringify(Object.fromEntries(state.tables.map((t) => [t.name, result.tables.get(t.name) ?? []])), null, 2);
      case "ndjson":
        return state.tables.length === 1 ? toNdjson(rows) : state.tables.map((t) => (result.tables.get(t.name) ?? []).map((r) => JSON.stringify({ _table: t.name, ...r })).join("\n")).join("\n");
      case "csv":
        return table ? toCsv(rows, table.columns.map((c) => c.name)) : "";
      case "sql":
        // Referenced tables first, so the INSERTs run in order.
        return sorted.map((t) => toSql(t, result.tables.get(t.name) ?? [], state.dialect, state.create)).join("\n\n");
    }
  };

  const importFrom = (kind: "json" | "sql") => {
    const view = getActiveEditor()?.view;
    if (!view) return void toast.info("Open a file with a JSON sample or CREATE TABLE statements first.");
    const sel = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
    const text = sel.trim() ? sel : view.state.doc.toString();
    try {
      if (kind === "json") {
        const name = (getActiveEditor()?.path?.split(/[\\/]/).pop() ?? "items").replace(/\.[^.]+$/, "").replace(/[^\w]+/g, "_") || "items";
        const t = tableFromJson(text, name);
        setState({ tables: [...state.tables, t] });
        setActive(state.tables.length);
        toast.success(`Added table “${t.name}” with ${t.columns.length} columns`);
      } else {
        const ts = tablesFromSql(text);
        if (!ts.length) throw new Error("No CREATE TABLE statement found.");
        setState({ tables: ts });
        setActive(0);
        toast.success(`Read ${ts.length} table${ts.length === 1 ? "" : "s"}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const save = async () => {
    const root = app().workspaceRoot();
    if (!root) return void toast.error("Open a folder first.");
    const base = state.format === "csv" && table ? table.name : state.tables.length === 1 ? (table?.name ?? "data") : "seed";
    const target = await inputBox({ title: "Save the data as", value: `${root.replace(/[\\/]+$/, "")}/${base}.${EXT[state.format]}` });
    if (!target?.trim()) return;
    try {
      await native.writeFile(target.trim(), output(), "user");
      toast.success(`Saved ${target.trim().split(/[\\/]/).pop()}`);
      app().openFile(target.trim());
    } catch (err) {
      toast.error(`Could not save: ${String(err)}`);
    }
  };

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-2">
        <select className={field} value="" onChange={(e) => e.target.value && (setState({ tables: structuredClone(TEMPLATES[e.target.value]) }), setActive(0))} data-datagen-template>
          <option value="">Start from…</option>
          {Object.keys(TEMPLATES).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <button type="button" className={btn} onClick={() => importFrom("json")} title="Uses the selection, or the whole file, of the last editor">
          From a JSON sample
        </button>
        <button type="button" className={btn} onClick={() => importFrom("sql")} title="Uses the selection, or the whole file, of the last editor">
          From CREATE TABLE
        </button>
        <span className="flex-1" />
        <span className="text-muted-foreground">Seed</span>
        <input className={cn(field, "w-20")} data-datagen-seed value={state.seed} onChange={(e) => setState({ seed: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
        <button type="button" className={btn} onClick={() => setState({ seed: Math.floor(Math.random() * 1e6) })} title="Different rows">
          ↻
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-[520px] shrink-0 overflow-auto border-r border-border/60 p-2">
          <div className="mb-2 flex flex-wrap items-center gap-1">
            {state.tables.map((t, i) => (
              <button key={i} type="button" data-datagen-table={t.name} className={cn(btn, i === active && "bg-muted font-medium")} onClick={() => setActive(i)}>
                {t.name} <span className="text-muted-foreground">{t.rows}</span>
              </button>
            ))}
            <button
              type="button"
              className={btn}
              onClick={() => {
                setState({ tables: [...state.tables, { name: `table${state.tables.length + 1}`, rows: 20, columns: [{ name: "id", type: "id" }] }] });
                setActive(state.tables.length);
              }}
            >
              + Table
            </button>
          </div>
          {table && (
            <>
              <div className="mb-2 flex items-center gap-2">
                <input className={cn(field, "w-40 font-medium")} value={table.name} onChange={(e) => setTable(active, { ...table, name: e.target.value.replace(/\s+/g, "_") })} />
                <input className={cn(field, "w-20")} data-datagen-rows value={table.rows} onChange={(e) => setTable(active, { ...table, rows: Math.min(100000, Number(e.target.value.replace(/\D/g, "")) || 0) })} />
                <span className="text-muted-foreground">rows</span>
                <span className="flex-1" />
                <button
                  type="button"
                  className={btn}
                  disabled={state.tables.length < 2}
                  onClick={() => {
                    setState({ tables: state.tables.filter((_, j) => j !== active) });
                    setActive(Math.max(0, active - 1));
                  }}
                >
                  Delete table
                </button>
              </div>
              <table className="w-full border-collapse">
                <thead className="text-left text-[11px] text-muted-foreground">
                  <tr>
                    <th className="pb-1 font-normal">Column</th>
                    <th className="pb-1 font-normal">Type</th>
                    <th className="pb-1 font-normal">Options</th>
                    <th className="pb-1 font-normal" title="Unique">U</th>
                    <th className="pb-1 font-normal" title="Share of empty values">Null %</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {table.columns.map((c, ci) => (
                    <tr key={ci} data-datagen-column={c.name}>
                      <td className="py-0.5 pr-1">
                        <input className={cn(field, "w-28 font-mono")} value={c.name} onChange={(e) => setColumn(ci, { ...c, name: e.target.value.replace(/\s+/g, "_") })} />
                      </td>
                      <td className="py-0.5 pr-1">
                        <select className={cn(field, "w-36")} value={c.type} onChange={(e) => setColumn(ci, { name: c.name, type: e.target.value as ColumnType, unique: c.unique, nullRatio: c.nullRatio })}>
                          {(Object.keys(TYPE_LABEL) as ColumnType[]).map((t) => (
                            <option key={t} value={t}>
                              {TYPE_LABEL[t]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-0.5 pr-1">
                        {c.type === "ref" ? (
                          <select className={cn(field, "w-36")} value={c.ref ?? ""} onChange={(e) => setColumn(ci, { ...c, ref: e.target.value })}>
                            <option value="">Choose…</option>
                            {state.tables.flatMap((t) => t.columns.map((col) => `${t.name}.${col.name}`)).map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        ) : PLACEHOLDER[c.type] ? (
                          <input className={cn(field, "w-36 font-mono text-[11.5px]")} key={`${ci}-${c.type}`} defaultValue={optionsText(c)} placeholder={PLACEHOLDER[c.type]} onChange={(e) => setColumn(ci, applyOptions(c, e.target.value))} />
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-0.5 pr-1 text-center">
                        <input type="checkbox" checked={Boolean(c.unique)} onChange={(e) => setColumn(ci, { ...c, unique: e.target.checked })} />
                      </td>
                      <td className="py-0.5 pr-1">
                        <input className={cn(field, "w-12")} value={c.nullRatio ? Math.round(c.nullRatio * 100) : ""} placeholder="0" onChange={(e) => setColumn(ci, { ...c, nullRatio: Math.min(100, Number(e.target.value.replace(/\D/g, "")) || 0) / 100 || undefined })} />
                      </td>
                      <td className="py-0.5">
                        <button type="button" className="px-1 text-muted-foreground hover:text-foreground" title="Remove column" onClick={() => setTable(active, { ...table, columns: table.columns.filter((_, j) => j !== ci) })}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" className={cn(btn, "mt-2")} data-datagen-add-column onClick={() => setTable(active, { ...table, columns: [...table.columns, { name: `column${table.columns.length + 1}`, type: "words" }] })}>
                + Column
              </button>
            </>
          )}
          {result.warnings.length > 0 && (
            <div className="mt-3 space-y-1" data-datagen-warnings>
              {result.warnings.map((w) => (
                <div key={w} className="rounded bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-400">
                  {w}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-2 py-1">
            {(["json", "ndjson", "csv", "sql"] as Format[]).map((f) => (
              <button key={f} type="button" data-datagen-format={f} className={cn(btn, state.format === f && "bg-muted font-medium")} onClick={() => setState({ format: f })}>
                {f.toUpperCase()}
              </button>
            ))}
            {state.format === "sql" && (
              <>
                <select className={field} value={state.dialect} onChange={(e) => setState({ dialect: e.target.value as Dialect })}>
                  <option value="postgres">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                  <option value="sqlite">SQLite</option>
                </select>
                <label className="flex items-center gap-1 text-muted-foreground">
                  <input type="checkbox" checked={state.create} onChange={(e) => setState({ create: e.target.checked })} />
                  CREATE TABLE
                </label>
              </>
            )}
            {state.format === "csv" && state.tables.length > 1 && <span className="text-muted-foreground">CSV holds one table: {table?.name}</span>}
            <span className="flex-1" />
            <button type="button" className={btn} onClick={() => void copyToClipboard(output()).then(() => toast.success("Copied"))}>
              Copy
            </button>
            <button
              type="button"
              className={btn}
              onClick={() => {
                const view = getActiveEditor()?.view;
                if (!view) return void toast.info("Open a file first.");
                view.dispatch(view.state.replaceSelection(output()));
                toast.success("Inserted");
              }}
            >
              Insert in editor
            </button>
            <button type="button" className={btn} data-datagen-save onClick={() => void save()}>
              Save…
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-[11.5px]" data-datagen-preview>
              <thead className="sticky top-0 bg-background text-left text-muted-foreground">
                <tr>{table?.columns.map((c) => <th key={c.name} className="whitespace-nowrap border-b border-border/60 px-2 py-1 font-normal">{c.name}</th>)}</tr>
              </thead>
              <tbody>
                {rows.slice(0, 100).map((r, i) => (
                  <tr key={i} className="border-b border-border/20">
                    {table?.columns.map((c) => (
                      <td key={c.name} className={cn("max-w-[220px] truncate whitespace-nowrap px-2 py-0.5 font-mono", r[c.name] === null && "text-muted-foreground")}>
                        {r[c.name] === null ? "null" : String(r[c.name])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 100 && <div className="p-2 text-muted-foreground">Showing 100 of {rows.length.toLocaleString()} rows; all of them are written out.</div>}
          </div>
        </div>
      </div>
    </div>
  );
});

export const DATAGEN_ACTIONS = [
  { id: "datagen.open", label: "Test data: Generate tables of realistic test data (JSON, CSV, SQL)", keywords: ["fake", "mock", "test data", "seed", "fixtures", "faker", "generate", "sql insert", "csv", "dataset", "sample data"], run: openDataGen },
];
