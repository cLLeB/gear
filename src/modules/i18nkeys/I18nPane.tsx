// gear-i18n://: every translation key next to its text in each language —
// what is missing, empty, untranslated or has different placeholders — with
// editing in place.

import { invoke } from "@tauri-apps/api/core";
import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { confirmPick, inputBox } from "@/modules/quick-pick";
import { toolPaneHandle } from "@/modules/tools/paneHandle";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { compare, countProblems, coverage, deleteKey, detectFormat, filterRows, findLocaleSets, flatten, keyProblem, serialize, setKey, type Filter, type Format, type Json, type LocaleSet, type Problem } from "./model";

export const I18N_PATH = "gear-i18n://Translations";

interface Loaded {
  path: string;
  json: Json;
  format: Format;
  error: string | null;
}

interface State {
  root: string;
  sets: LocaleSet[];
  setIndex: number;
  /** locale -> its file, parsed. */
  files: Record<string, Loaded>;
  base: string;
  busy: boolean;
  error: string | null;
  scanned: boolean;
}

export const useI18n = create<State>(() => ({ root: "", sets: [], setIndex: 0, files: {}, base: "", busy: false, error: null, scanned: false }));

const join = (root: string, rel: string) => `${root.replace(/[\\/]+$/, "")}/${rel}`;

async function loadSet(root: string, set: LocaleSet): Promise<Record<string, Loaded>> {
  const out: Record<string, Loaded> = {};
  await Promise.all(
    Object.entries(set.files).map(async ([locale, rel]) => {
      const path = join(root, rel);
      const r = await native.readFile(path).catch(() => null);
      if (!r || r.kind !== "text") return void (out[locale] = { path, json: {}, format: detectFormat(""), error: "could not be read" });
      try {
        out[locale] = { path, json: (r.content.trim() ? JSON.parse(r.content) : {}) as Json, format: detectFormat(r.content), error: null };
      } catch (err) {
        out[locale] = { path, json: {}, format: detectFormat(r.content), error: `is not valid JSON (${(err as Error).message})` };
      }
    }),
  );
  return out;
}

function pickBase(locales: string[], previous: string): string {
  if (locales.includes(previous)) return previous;
  return locales.find((l) => l === "en") ?? locales.find((l) => /^en[-_]/i.test(l)) ?? locales[0] ?? "";
}

export async function scanTranslations(setIndex?: number): Promise<void> {
  const root = app().workspaceRoot();
  if (!root) return void useI18n.setState({ error: "Open a folder first.", scanned: true });
  useI18n.setState({ busy: true, error: null, root });
  try {
    const listed = await invoke<{ files: string[] }>("fs_list_files", { root, limit: 10000, maxDepth: 12, workspace: currentWorkspaceEnv() });
    const sets = findLocaleSets(listed.files);
    const index = Math.min(setIndex ?? useI18n.getState().setIndex, Math.max(0, sets.length - 1));
    const files = sets[index] ? await loadSet(root, sets[index]) : {};
    useI18n.setState({ sets, setIndex: index, files, base: pickBase(Object.keys(files).sort(), useI18n.getState().base), busy: false, scanned: true });
  } catch (err) {
    useI18n.setState({ busy: false, error: String(err), scanned: true });
  }
}

export function openTranslations(): void {
  app().openFile(I18N_PATH);
  if (!useI18n.getState().scanned && !useI18n.getState().busy) void scanTranslations();
}

/** Applies a change to one locale's JSON, writes the file, and updates the store. */
async function write(locale: string, change: (json: Json) => Json): Promise<boolean> {
  const f = useI18n.getState().files[locale];
  if (!f || f.error) return false;
  const json = change(f.json);
  try {
    await native.writeFile(f.path, serialize(json, f.format), "user");
    useI18n.setState((s) => ({ files: { ...s.files, [locale]: { ...f, json } } }));
    return true;
  } catch (err) {
    toast.error(`Could not save ${f.path}: ${String(err)}`);
    return false;
  }
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const TONE: Record<Problem, string> = { missing: "bg-red-500/10", empty: "bg-red-500/10", same: "bg-amber-500/10", placeholders: "bg-violet-500/15" };
const LABEL: Record<Problem, string> = { missing: "missing", empty: "empty", same: "same as the base text", placeholders: "placeholders differ from the base" };
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "problems", label: "Needs attention" },
  { id: "missing", label: "Missing" },
  { id: "empty", label: "Empty" },
  { id: "same", label: "Untranslated" },
  { id: "placeholders", label: "Placeholders" },
];

export const I18nPane = forwardRef<EditorPaneHandle, { path: string }>(function I18nPane({ path }, ref) {
  const { sets, setIndex, files, base, busy, error, scanned } = useI18n();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ key: string; locale: string; text: string } | null>(null);
  const [limit, setLimit] = useState(300);

  useImperativeHandle(ref, () => toolPaneHandle(path, { setQuery, clearQuery: () => setQuery(""), reload: () => (void scanTranslations(), true) }), [path]);

  const locales = useMemo(() => [base, ...Object.keys(files).filter((l) => l !== base).sort()].filter((l) => l in files), [files, base]);
  const flat = useMemo(() => Object.fromEntries(locales.map((l) => [l, flatten(files[l].json)])), [files, locales]);
  const rows = useMemo(() => (base ? compare(flat, base) : []), [flat, base]);
  const shown = useMemo(() => filterRows(rows, filter, query), [rows, filter, query]);

  const commit = async () => {
    if (!editing) return;
    const { key, locale, text } = editing;
    setEditing(null);
    if ((flat[locale]?.[key] ?? "") === text) return;
    await write(locale, (json) => setKey(json, key, text));
  };

  const addKey = async () => {
    const key = (await inputBox({ title: "New translation key", placeholder: "menu.file.open", validate: (v) => keyProblem(v, rows.map((r) => r.key)) }))?.trim();
    if (!key) return;
    const text = await inputBox({ title: `Text for “${key}” in ${base}`, placeholder: "The text in the base language" });
    if (text === undefined) return;
    // Other languages get an empty text, so the key shows up as work to do.
    for (const l of locales) await write(l, (json) => setKey(json, key, l === base ? text : ""));
    setQuery(key);
    toast.success(`Added ${key} to ${locales.length} files`);
  };

  const removeKey = async (key: string) => {
    if (!(await confirmPick(`Delete “${key}” from every language?`, "Delete the key", `${locales.filter((l) => flat[l][key] !== undefined).length} files will change.`))) return;
    for (const l of locales) if (flat[l][key] !== undefined) await write(l, (json) => deleteKey(json, key));
  };

  if (busy && !scanned) return <div className="p-6 text-[12.5px] text-muted-foreground">Looking for translation files…</div>;
  if (error) return <div className="p-6 text-[12.5px] text-red-500">{error}</div>;
  if (!sets.length)
    return (
      <div className="max-w-[660px] space-y-2 p-6 text-[12.5px] text-muted-foreground">
        <div>No translation files found in this folder.</div>
        <div>
          This looks for JSON files named after a language in a folder such as <code>locales</code>, <code>i18n</code>, <code>lang</code>, <code>translations</code> or <code>messages</code> — either <code>locales/en.json</code>, <code>locales/fr.json</code> or <code>locales/en/common.json</code>, <code>locales/fr/common.json</code>.
        </div>
        <button type="button" className={btn} onClick={() => void scanTranslations()}>
          Look again
        </button>
      </div>
    );

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 p-2">
        {sets.length > 1 ? (
          <select className="max-w-[280px] rounded border border-border/60 bg-background px-1.5 py-0.5 font-mono text-[12px]" value={setIndex} onChange={(e) => void scanTranslations(Number(e.target.value))}>
            {sets.map((s, i) => (
              <option key={s.label} value={i}>
                {s.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="font-mono text-[12px] text-muted-foreground">{sets[0].label}</span>
        )}
        <span className="text-muted-foreground">base</span>
        <select className="rounded border border-border/60 bg-background px-1.5 py-0.5 font-mono text-[12px]" data-i18n-base value={base} onChange={(e) => useI18n.setState({ base: e.target.value })}>
          {Object.keys(files)
            .sort()
            .map((l) => (
              <option key={l}>{l}</option>
            ))}
        </select>
        <span className="mx-1 h-4 w-px bg-border" />
        {FILTERS.map((f) => (
          <button key={f.id} type="button" data-filter={f.id} className={cn(btn, filter === f.id && "bg-muted font-medium")} onClick={() => (setFilter(f.id), setLimit(300))}>
            {f.label}
          </button>
        ))}
        <span className="flex-1" />
        <input className="w-[190px] rounded border border-border/60 bg-background px-2 py-0.5 text-[12px] outline-none focus:border-ring" value={query} placeholder="Find a key or a text" onChange={(e) => (setQuery(e.target.value), setLimit(300))} />
        <button type="button" className={cn(btn, "bg-primary/10")} onClick={() => void addKey()}>
          + Key
        </button>
        <button type="button" className={btn} onClick={() => void scanTranslations()}>
          Reload
        </button>
      </div>
      {locales.some((l) => files[l].error) && (
        <div className="border-b border-border/60 bg-red-500/10 px-3 py-1 text-red-500">
          {locales
            .filter((l) => files[l].error)
            .map((l) => `${l}: the file ${files[l].error}`)
            .join(" · ")}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 min-w-[220px] border-b border-r border-border/60 bg-muted px-2 py-1 text-left font-medium">
                Key <span className="font-normal text-muted-foreground">({shown.length === rows.length ? rows.length : `${shown.length} of ${rows.length}`})</span>
              </th>
              {locales.map((l) => {
                const c = countProblems(rows, l);
                const todo = c.missing + c.empty;
                return (
                  <th key={l} data-locale={l} className="sticky top-0 z-10 min-w-[220px] border-b border-r border-border/60 bg-muted px-2 py-1 text-left font-medium">
                    <button type="button" className="hover:underline" title="Open the file" onClick={() => app().openFile(files[l].path)}>
                      {l}
                    </button>
                    {l === base ? <span className="ml-1.5 font-normal text-muted-foreground">base</span> : <span className={cn("ml-1.5 font-normal", todo ? "text-amber-600" : "text-emerald-600")}>{coverage(rows, l, base)}%</span>}
                    {l !== base && (todo > 0 || c.same > 0 || c.placeholders > 0) && <span className="ml-1.5 font-normal text-muted-foreground">{[todo && `${todo} to do`, c.same && `${c.same} same`, c.placeholders && `${c.placeholders} placeholders`].filter(Boolean).join(", ")}</span>}
                  </th>
                );
              })}
              <th className="sticky top-0 z-10 w-[36px] border-b border-border/60 bg-muted" />
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((r) => (
              <tr key={r.key} data-key={r.key} className="group">
                <td className="sticky left-0 z-10 max-w-[320px] border-b border-r border-border/40 bg-background px-2 py-0.5 font-mono text-[12px]">
                  <div className="truncate" title={r.key}>
                    {r.key}
                  </div>
                </td>
                {locales.map((l) => {
                  const p = r.problems[l];
                  const isEditing = editing?.key === r.key && editing.locale === l;
                  return (
                    <td key={l} data-cell={`${r.key}|${l}`} className={cn("max-w-[420px] border-b border-r border-border/40 px-2 py-0.5 align-top", p && TONE[p])} title={p ? LABEL[p] : undefined} onClick={() => !isEditing && !files[l].error && setEditing({ key: r.key, locale: l, text: r.values[l] ?? "" })}>
                      {isEditing ? (
                        <textarea
                          autoFocus
                          className="w-full resize-y rounded border border-ring bg-background p-1 text-[12.5px] outline-none"
                          rows={Math.min(6, Math.max(1, Math.ceil(editing.text.length / 44)))}
                          value={editing.text}
                          onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                          onBlur={() => void commit()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), void commit());
                            if (e.key === "Escape") setEditing(null);
                          }}
                        />
                      ) : r.values[l] === undefined ? (
                        <span className="text-red-500">missing</span>
                      ) : r.values[l] === "" ? (
                        <span className="text-red-500">empty</span>
                      ) : (
                        <span className="whitespace-pre-wrap break-words">{r.values[l]}</span>
                      )}
                    </td>
                  );
                })}
                <td className="border-b border-border/40 px-1 text-center">
                  <button type="button" className="rounded px-1 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100" title="Delete this key from every language" onClick={() => void removeKey(r.key)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <div className="p-4 text-muted-foreground">{rows.length ? "Nothing matches — every key is fine for this filter." : "These files have no keys yet. Use “+ Key” to add the first."}</div>}
        {shown.length > limit && (
          <button type="button" className={cn(btn, "m-3")} onClick={() => setLimit(limit + 500)}>
            Show more ({shown.length - limit} hidden)
          </button>
        )}
      </div>
      <div className="border-t border-border/60 px-2 py-1 text-muted-foreground">Click a text to edit it; Enter saves, Shift+Enter adds a line. Red: missing or empty. Amber: same text as the base. Violet: placeholders differ.</div>
    </div>
  );
});

export const I18N_ACTIONS = [{ id: "i18n.open", label: "Translations: Compare and edit translation files", keywords: ["i18n", "l10n", "translations", "locales", "languages", "missing keys", "localization", "internationalization"], run: openTranslations }];
