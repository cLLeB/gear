// gear-env://: every .env file of the workspace side by side — which
// variables are missing, empty or different — with values hidden until asked for.

import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { confirmPick, inputBox, quickPick } from "@/modules/quick-pick";
import { toolPaneHandle } from "@/modules/tools/paneHandle";
import { compareEnv, duplicates, filterEnv, isEnvFileName, isTemplate, keyNameProblem, mask, orderFiles, parseEnv, removeKey, serializeEnv, setValue, type Cell, type EnvFile, type Filter } from "./model";

export const ENV_PATH = "gear-env://Environment files";

interface State {
  root: string;
  files: Record<string, EnvFile>;
  busy: boolean;
  error: string | null;
  scanned: boolean;
}

export const useEnvMatrix = create<State>(() => ({ root: "", files: {}, busy: false, error: null, scanned: false }));

const join = (root: string, name: string) => `${root.replace(/[\\/]+$/, "")}/${name}`;

export async function scanEnv(): Promise<void> {
  const root = app().workspaceRoot();
  if (!root) return void useEnvMatrix.setState({ error: "Open a folder first.", scanned: true });
  useEnvMatrix.setState({ busy: true, error: null, root });
  try {
    const names = (await native.readDirAll(root)).filter((e) => e.kind === "file" && isEnvFileName(e.name)).map((e) => e.name);
    const files: Record<string, EnvFile> = {};
    await Promise.all(
      names.map(async (name) => {
        const r = await native.readFile(join(root, name)).catch(() => null);
        if (r?.kind === "text") files[name] = parseEnv(r.content);
      }),
    );
    useEnvMatrix.setState({ files, busy: false, scanned: true });
  } catch (err) {
    useEnvMatrix.setState({ busy: false, error: String(err), scanned: true });
  }
}

export function openEnvMatrix(): void {
  app().openFile(ENV_PATH);
  void scanEnv();
}

async function write(name: string, change: (f: EnvFile) => EnvFile): Promise<boolean> {
  const { root, files } = useEnvMatrix.getState();
  const next = change(files[name] ?? parseEnv(""));
  try {
    await native.writeFile(join(root, name), serializeEnv(next), "user");
    useEnvMatrix.setState((s) => ({ files: { ...s.files, [name]: next } }));
    return true;
  } catch (err) {
    toast.error(`Could not save ${name}: ${String(err)}`);
    return false;
  }
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const TONE: Record<Cell, string> = { ok: "", missing: "bg-red-500/10", empty: "bg-red-500/10", differs: "bg-amber-500/10" };
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "problems", label: "Missing or empty" },
  { id: "differs", label: "Different values" },
];

export const EnvPane = forwardRef<EditorPaneHandle, { path: string }>(function EnvPane({ path }, ref) {
  const { files, busy, error, scanned, root } = useEnvMatrix();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [reveal, setReveal] = useState(false);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ key: string; file: string; text: string } | null>(null);

  useImperativeHandle(ref, () => toolPaneHandle(path, { setQuery, clearQuery: () => setQuery(""), reload: () => (void scanEnv(), true) }), [path]);

  const order = useMemo(() => orderFiles(Object.keys(files)), [files]);
  const rows = useMemo(() => compareEnv(files, order), [files, order]);
  const visible = useMemo(() => filterEnv(rows, filter, query), [rows, filter, query]);
  const dups = useMemo(() => Object.fromEntries(order.map((n) => [n, duplicates(files[n])])), [files, order]);

  const commit = async () => {
    if (!editing) return;
    const { key, file, text } = editing;
    setEditing(null);
    if (files[file] && rows.find((r) => r.key === key)?.values[file] === text) return;
    await write(file, (f) => setValue(f, key, text));
  };

  const addKey = async () => {
    const key = (await inputBox({ title: "New variable", placeholder: "API_URL", validate: (v) => keyNameProblem(v, rows.map((r) => r.key)) }))?.trim();
    if (!key) return;
    for (const n of order) await write(n, (f) => setValue(f, key, ""));
    setQuery(key);
    toast.success(`Added ${key} to ${order.length} files — fill in the values`);
  };

  const newFile = async () => {
    const template = order.find(isTemplate);
    const name = (await inputBox({ title: "New .env file", value: order.includes(".env") ? ".env.local" : ".env", validate: (v) => (!isEnvFileName(v.trim()) ? "Use a name like .env, .env.local or .env.production" : order.includes(v.trim()) ? "That file already exists." : null) }))?.trim();
    if (!name) return;
    const source = template ? files[template] : parseEnv("");
    if (await write(name, () => source)) toast.success(template ? `Created ${name} from ${template}` : `Created ${name}`);
  };

  const cellMenu = async (key: string, file: string) => {
    const row = rows.find((r) => r.key === key);
    if (!row) return;
    const others = order.filter((n) => n !== file && row.values[n] !== undefined && row.values[n] !== "");
    const pick = await quickPick(
      [
        { label: "Edit the value", value: () => setEditing({ key, file, text: row.values[file] ?? "" }) },
        ...others.map((n) => ({ label: `Copy the value from ${n}`, value: () => void write(file, (f) => setValue(f, key, row.values[n] ?? "")) })),
        ...(row.values[file] ? [{ label: "Copy the value to the clipboard", value: () => void navigator.clipboard.writeText(row.values[file] ?? "") }] : []),
        ...(row.values[file] !== undefined ? [{ label: `Remove ${key} from ${file}`, value: () => void write(file, (f) => removeKey(f, key)) }] : []),
      ],
      { title: `${key} in ${file}` },
    );
    pick?.();
  };

  const removeEverywhere = async (key: string) => {
    if (!(await confirmPick(`Remove ${key} from every file?`, "Remove the variable", `${order.filter((n) => rows.find((r) => r.key === key)?.values[n] !== undefined).length} files will change.`))) return;
    for (const n of order) if (rows.find((r) => r.key === key)?.values[n] !== undefined) await write(n, (f) => removeKey(f, key));
  };

  if (busy && !scanned) return <div className="p-6 text-[12.5px] text-muted-foreground">Looking for .env files…</div>;
  if (error) return <div className="p-6 text-[12.5px] text-red-500">{error}</div>;
  if (!order.length)
    return (
      <div className="space-y-2 p-6 text-[12.5px] text-muted-foreground">
        <div>There are no .env files in the top folder of this workspace.</div>
        <button type="button" className={btn} onClick={() => void newFile()}>
          Create one
        </button>
      </div>
    );

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 p-2">
        <span className="text-muted-foreground">
          {rows.length} variables in {order.length} files
        </span>
        <span className="mx-1 h-4 w-px bg-border" />
        {FILTERS.map((f) => (
          <button key={f.id} type="button" data-filter={f.id} className={cn(btn, filter === f.id && "bg-muted font-medium")} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
        <span className="flex-1" />
        <input className="w-[170px] rounded border border-border/60 bg-background px-2 py-0.5 text-[12px] outline-none focus:border-ring" value={query} placeholder="Find a variable" onChange={(e) => setQuery(e.target.value)} />
        <label className="flex items-center gap-1" title="Values are hidden so they do not end up in a screenshot or a screen share">
          <input type="checkbox" data-reveal checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
          Show values
        </label>
        <button type="button" className={cn(btn, "bg-primary/10")} onClick={() => void addKey()}>
          + Variable
        </button>
        <button type="button" className={btn} onClick={() => void newFile()}>
          + File
        </button>
        <button type="button" className={btn} onClick={() => void scanEnv()}>
          Reload
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 min-w-[220px] border-b border-r border-border/60 bg-muted px-2 py-1 text-left font-medium">Variable</th>
              {order.map((n) => {
                const missing = rows.filter((r) => r.cells[n] === "missing" || r.cells[n] === "empty").length;
                return (
                  <th key={n} data-env-file={n} className="sticky top-0 z-10 min-w-[200px] border-b border-r border-border/60 bg-muted px-2 py-1 text-left font-medium">
                    <button type="button" className="font-mono hover:underline" title="Open the file" onClick={() => app().openFile(join(root, n))}>
                      {n}
                    </button>
                    {isTemplate(n) && <span className="ml-1.5 font-normal text-muted-foreground">template</span>}
                    {missing > 0 && <span className="ml-1.5 font-normal text-amber-600">{missing} to fill in</span>}
                    {dups[n].length > 0 && (
                      <span className="ml-1.5 font-normal text-red-500" title={`Set more than once: ${dups[n].join(", ")} — the last one wins`}>
                        {dups[n].length} repeated
                      </span>
                    )}
                  </th>
                );
              })}
              <th className="sticky top-0 z-10 w-[36px] border-b border-border/60 bg-muted" />
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.key} data-env-key={r.key} className="group">
                <td className="sticky left-0 z-10 border-b border-r border-border/40 bg-background px-2 py-0.5 font-mono text-[12px]">
                  {r.key}
                  {r.secret && (
                    <span className="ml-1.5 rounded bg-muted px-1 font-sans text-[10.5px] text-muted-foreground" title="Looks like a secret by its name">
                      secret
                    </span>
                  )}
                </td>
                {order.map((n) => {
                  const v = r.values[n];
                  const isEditing = editing?.key === r.key && editing.file === n;
                  const cellId = `${r.key}|${n}`;
                  const open = reveal || shown.has(cellId);
                  return (
                    <td key={n} data-env-cell={cellId} className={cn("max-w-[360px] border-b border-r border-border/40 px-2 py-0.5 font-mono text-[12px]", TONE[r.cells[n]])}>
                      {isEditing ? (
                        <input
                          autoFocus
                          className="w-full rounded border border-ring bg-background px-1 outline-none"
                          value={editing.text}
                          onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                          onBlur={() => void commit()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void commit();
                            if (e.key === "Escape") setEditing(null);
                          }}
                        />
                      ) : (
                        <div className="flex items-center gap-1">
                          <button type="button" className="min-w-0 flex-1 truncate text-left" title="Click to edit" onClick={() => setEditing({ key: r.key, file: n, text: v ?? "" })}>
                            {v === undefined ? <span className="font-sans text-red-500">missing</span> : v === "" ? <span className={cn("font-sans", isTemplate(n) ? "text-muted-foreground" : "text-red-500")}>empty</span> : open ? v : mask(v)}
                          </button>
                          {v && !reveal && (
                            <button
                              type="button"
                              className="shrink-0 rounded px-1 font-sans text-[10.5px] text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100"
                              onClick={() => {
                                const next = new Set(shown);
                                if (!next.delete(cellId)) next.add(cellId);
                                setShown(next);
                              }}
                            >
                              {open ? "hide" : "show"}
                            </button>
                          )}
                          <button type="button" className="shrink-0 rounded px-1 font-sans text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100" title="More" onClick={() => void cellMenu(r.key, n)}>
                            ⋯
                          </button>
                        </div>
                      )}
                    </td>
                  );
                })}
                <td className="border-b border-border/40 px-1 text-center">
                  <button type="button" className="rounded px-1 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100" title="Remove from every file" onClick={() => void removeEverywhere(r.key)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && <div className="p-4 text-muted-foreground">{rows.length ? "Nothing matches this filter." : "These files have no variables yet."}</div>}
      </div>
      <div className="border-t border-border/60 px-2 py-1 text-muted-foreground">Red: missing or empty. Amber: the files disagree. Only the edited line of a file is rewritten; comments and order are kept.</div>
    </div>
  );
});

export const ENV_ACTIONS = [{ id: "env.matrix", label: "Environment: Compare .env files side by side", keywords: ["env", "dotenv", "environment", "variables", "secrets", "compare", "missing", "example"], run: openEnvMatrix }];
