// gear-migrations://<scope>: PostgreSQL migrations checked before they reach
// a live database — the changed ones on this branch, every migration in the
// workspace, or one file — with the lock each statement takes and a safer
// way to write the risky ones.

import { invoke } from "@tauri-apps/api/core";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { toast } from "sonner";
import { app, frontFilePath } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { copyToClipboard, toolPaneHandle } from "@/modules/tools/paneHandle";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { LOCK_BLOCKS, lintMigration, lockSummary, MIGRATION_PATH, type Finding, type Report, type Severity } from "./model";

const SCHEME = "gear-migrations://";
const TX_KEY = "gear.migrations.implicitTransaction";
const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const SEV_STYLE: Record<Severity, string> = {
  danger: "bg-red-500/15 text-red-600",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  info: "bg-sky-500/15 text-sky-600",
};
const LOCK_STYLE = (lock: string) => (lock === "ACCESS EXCLUSIVE" ? "text-red-600" : /^(SHARE|SHARE ROW EXCLUSIVE|EXCLUSIVE)$/.test(lock) ? "text-amber-600" : "text-emerald-600");

type Scope = "changed" | "all";

export function openMigrationCheck(scope: Scope | string = "changed"): void {
  app().openFile(`${SCHEME}${scope}`);
}

export function openMigrationCheckForCurrent(): void {
  const current = frontFilePath() ?? getActiveEditor()?.path ?? "";
  if (!/\.sql$/i.test(current)) return void toast.info("Open a .sql migration first");
  openMigrationCheck(current);
}

const rel = (root: string, p: string) => p.replace(/\\/g, "/").replace(`${root.replace(/\\/g, "/").replace(/\/+$/, "")}/`, "");

function readTx(): boolean {
  try {
    return localStorage.getItem(TX_KEY) === "1";
  } catch {
    return false;
  }
}

/** The text of `path`: the open editor's (unsaved changes included) when it shows that file, else the disk's. */
async function textOf(path: string): Promise<string | null> {
  const ed = getActiveEditor();
  if (ed?.path && ed.path.replace(/\\/g, "/").toLowerCase() === path.replace(/\\/g, "/").toLowerCase()) return ed.view.state.doc.toString();
  const r = await native.readFile(path).catch(() => null);
  return r && r.kind === "text" ? r.content : null;
}

/** Migration files changed on this branch (against main/master) or not yet committed. */
async function changedMigrations(root: string): Promise<string[]> {
  const run = async (cmd: string) => {
    const r = await native.runCommand(cmd, root, 30).catch(() => null);
    return r && r.exit_code === 0 ? r.stdout : null;
  };
  const head = (await run("git symbolic-ref --short refs/remotes/origin/HEAD"))?.trim().replace(/^origin\//, "");
  const base = head || ((await run("git rev-parse --verify --quiet main")) !== null ? "main" : (await run("git rev-parse --verify --quiet master")) !== null ? "master" : null);
  const files = new Set<string>();
  const add = (out: string | null) => out?.split(/\r?\n/).forEach((f) => f.trim() && files.add(f.trim()));
  if (base) add(await run(`git diff --name-only --diff-filter=AM ${base}...HEAD`));
  add(await run("git diff --name-only --diff-filter=AM HEAD"));
  add(await run("git ls-files --others --exclude-standard"));
  return [...files].filter((f) => /\.sql$/i.test(f) && MIGRATION_PATH.test(f));
}

interface FileResult {
  path: string;
  report: Report;
}

export const MigrationPane = forwardRef<EditorPaneHandle, { path: string }>(function MigrationPane({ path }, ref) {
  const target = path.startsWith(SCHEME) ? path.slice(SCHEME.length) : path;
  const scope: Scope | "file" = target === "changed" || target === "all" ? target : "file";
  const [results, setResults] = useState<FileResult[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [implicitTx, setImplicitTx] = useState(readTx);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hideInfo, setHideInfo] = useState(false);
  const root = app().workspaceRoot() ?? "";

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      let files: string[];
      if (scope === "file") files = [target];
      else {
        if (!root) throw new Error("Open a folder first.");
        const list =
          scope === "changed"
            ? await changedMigrations(root)
            : (await invoke<{ files: string[] }>("fs_list_files", { root, limit: 30000, maxDepth: 12, workspace: currentWorkspaceEnv() })).files.map((f) => f.replace(/\\/g, "/")).filter((f) => /\.sql$/i.test(f) && MIGRATION_PATH.test(f));
        files = list.sort().map((f) => `${root.replace(/[\\/]+$/, "")}/${f}`);
      }
      const out: FileResult[] = [];
      for (const f of files.slice(0, 2000)) {
        const text = await textOf(f);
        if (text !== null) out.push({ path: f, report: lintMigration(text, { implicitTransaction: implicitTx }) });
      }
      setResults(out);
      setSelected((cur) => (cur && out.some((r) => r.path === cur) ? cur : (out.find((r) => r.report.findings.some((x) => x.severity !== "info"))?.path ?? out[0]?.path ?? null)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [scope, target, root, implicitTx]);
  useEffect(() => void run(), [run]);
  useImperativeHandle(ref, () => toolPaneHandle(path, { reload: () => (void run(), true) }), [path, run]);

  const toggleTx = (v: boolean) => {
    setImplicitTx(v);
    try {
      localStorage.setItem(TX_KEY, v ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  };

  const current = useMemo(() => results?.find((r) => r.path === selected) ?? null, [results, selected]);
  const totals = useMemo(() => {
    const t = { danger: 0, warning: 0, info: 0 };
    for (const r of results ?? []) for (const f of r.report.findings) t[f.severity]++;
    return t;
  }, [results]);

  const openAt = (f: string, line: number) => app().openFile(f, line, 1);
  const shown = (fs: Finding[]) => fs.filter((f) => !hideInfo || f.severity !== "info");

  if (error) return <div className="p-6 text-[12.5px] text-red-500" data-migrations-error>{error}</div>;
  if (!results) return <div className="p-6 text-[12.5px] text-muted-foreground">Checking migrations…</div>;

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-2">
        {scope !== "file" ? (
          <div className="flex rounded border border-border/60">
            {(["changed", "all"] as Scope[]).map((s) => (
              <button key={s} type="button" data-migrations-scope={s} className={cn("px-2 py-0.5 text-[11.5px]", scope === s ? "bg-primary/15 text-primary" : "hover:bg-muted")} onClick={() => app().openFile(`${SCHEME}${s}`)}>
                {s === "changed" ? "Changed on this branch" : "All migrations"}
              </button>
            ))}
          </div>
        ) : (
          <span className="font-mono text-[12px]">{rel(root, target)}</span>
        )}
        <span className="text-muted-foreground" data-migrations-summary>
          {results.length} file{results.length === 1 ? "" : "s"} · {totals.danger} dangerous · {totals.warning} warning{totals.warning === 1 ? "" : "s"} · {totals.info} note{totals.info === 1 ? "" : "s"}
        </span>
        <span className="flex-1" />
        <label className="flex items-center gap-1 text-[11.5px]" title="Flyway, Rails, Django and others run each migration file inside a transaction">
          <input type="checkbox" checked={implicitTx} onChange={(e) => toggleTx(e.target.checked)} data-migrations-tx /> My tool wraps each file in a transaction
        </label>
        <label className="flex items-center gap-1 text-[11.5px]">
          <input type="checkbox" checked={hideInfo} onChange={(e) => setHideInfo(e.target.checked)} /> Hide notes
        </label>
        <button type="button" className={btn} disabled={busy} onClick={() => void run()}>
          {busy ? "Checking…" : "Check again"}
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        {scope !== "file" && (
          <div className="w-72 shrink-0 overflow-auto border-r border-border/60">
            {results.length === 0 && <div className="p-3 text-muted-foreground">{scope === "changed" ? "No migration files changed on this branch." : "No .sql files in migration folders."}</div>}
            {results.map((r) => {
              const d = r.report.findings.filter((f) => f.severity === "danger").length;
              const w = r.report.findings.filter((f) => f.severity === "warning").length;
              return (
                <button key={r.path} type="button" data-migrations-file={rel(root, r.path)} className={cn("flex w-full items-baseline gap-1.5 px-2 py-0.5 text-left hover:bg-muted/50", selected === r.path && "bg-primary/10")} onClick={() => setSelected(r.path)}>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]" title={r.path}>
                    {rel(root, r.path)}
                  </span>
                  {d > 0 && <span className="rounded bg-red-500/15 px-1 text-[10.5px] text-red-600">{d}</span>}
                  {w > 0 && <span className="rounded bg-amber-500/15 px-1 text-[10.5px] text-amber-700">{w}</span>}
                  {d + w === 0 && <span className="text-[10.5px] text-emerald-600">ok</span>}
                </button>
              );
            })}
          </div>
        )}
        <div className="min-w-0 flex-1 overflow-auto p-3">
          {current && (
            <div className="space-y-3">
              {scope !== "file" && (
                <button type="button" className="font-mono text-[12px] font-medium hover:underline" onClick={() => openAt(current.path, 1)}>
                  {rel(root, current.path)}
                </button>
              )}
              <section data-migrations-locks>
                <div className="mb-1 text-[11.5px] font-medium text-muted-foreground">Locks taken</div>
                {lockSummary(current.report.locks).length === 0 ? (
                  <div className="text-muted-foreground">No table locks beyond reads.</div>
                ) : (
                  <table className="text-[12px]">
                    <tbody>
                      {lockSummary(current.report.locks).map((l) => (
                        <tr key={l.table} data-migrations-lock={l.table}>
                          <td className="pr-3 font-mono">{l.table}</td>
                          <td className={cn("pr-3 font-medium", l.isNew ? "text-muted-foreground" : LOCK_STYLE(l.lock))}>{l.lock}</td>
                          <td className="text-muted-foreground">{l.isNew ? "new table, nothing else uses it yet" : `blocks ${LOCK_BLOCKS[l.lock]}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
              <section>
                <div className="mb-1 text-[11.5px] font-medium text-muted-foreground">
                  {shown(current.report.findings).length ? `${shown(current.report.findings).length} finding${shown(current.report.findings).length === 1 ? "" : "s"}` : "Findings"}
                </div>
                {shown(current.report.findings).length === 0 && <div className="text-emerald-600" data-migrations-ok>Nothing risky found in {current.report.statements.length} statement{current.report.statements.length === 1 ? "" : "s"}.</div>}
                {shown(current.report.findings).map((f, i) => (
                  <div key={i} className="mb-2 rounded border border-border/50 p-2" data-migrations-finding={f.rule}>
                    <div className="flex items-baseline gap-2">
                      <span className={cn("rounded px-1 text-[10.5px]", SEV_STYLE[f.severity])}>{f.severity}</span>
                      <button type="button" className="font-mono text-[11.5px] text-primary hover:underline" onClick={() => openAt(current.path, f.line)}>
                        line {f.line}
                      </button>
                      <span className="font-mono text-[11px] text-muted-foreground">{f.rule}</span>
                    </div>
                    <div className="mt-1">{f.message}</div>
                    {f.fix && (
                      <div className="mt-1.5">
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          Safer
                          <button type="button" className="hover:text-foreground" onClick={() => void copyToClipboard(f.fix as string).then(() => toast.success("Copied"))}>
                            copy
                          </button>
                        </div>
                        <pre className="mt-0.5 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-1.5 font-mono text-[11.5px]">{f.fix}</pre>
                      </div>
                    )}
                  </div>
                ))}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export const MIGRATION_ACTIONS = [
  { id: "migrations.changed", label: "Migrations: Check this branch's SQL migrations for locks and downtime (PostgreSQL)", keywords: ["migration", "postgres", "postgresql", "sql", "lock", "downtime", "zero downtime", "index concurrently", "squawk", "strong migrations", "schema"], run: () => openMigrationCheck("changed") },
  { id: "migrations.all", label: "Migrations: Check every SQL migration in the workspace", keywords: ["migration", "postgres", "sql", "lock", "schema"], run: () => openMigrationCheck("all") },
  { id: "migrations.file", label: "Migrations: Check this SQL file for locks and downtime", keywords: ["migration", "postgres", "sql", "lock", "current file"], run: openMigrationCheckForCurrent },
];
