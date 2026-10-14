// gear-codestats://: lines of code by language, and from git history the
// hotspots (large files that keep changing), files that change together,
// who works on what, and how active the project has been.

import { invoke } from "@tauri-apps/api/core";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { git } from "@/modules/git-actions/gitCli";
import { formatBytes, toolPaneHandle } from "@/modules/tools/paneHandle";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { busFactor, byLanguage, churn, contributors, countLines, coupling, hotspots, isCounted, languageOf, logArgs, parseLog, weeklyActivity, type Churn, type Commit, type FileStat } from "./model";

export const CODESTATS_PATH = "gear-codestats://Code stats";

export function openCodeStats(): void {
  app().openFile(CODESTATS_PATH);
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const PERIODS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
  { days: 36500, label: "All time" },
];
const LANG_COLORS = ["bg-sky-500", "bg-emerald-500", "bg-amber-500", "bg-purple-500", "bg-rose-500", "bg-teal-500", "bg-orange-500", "bg-indigo-500", "bg-lime-500", "bg-pink-500"];

type Tab = "overview" | "hotspots" | "coupling" | "people" | "files";

interface Scan {
  root: string;
  files: FileStat[];
  commits: Commit[] | null;
  gitError: string | null;
  /** Path of the workspace inside the repository, "" when they are the same. */
  prefix: string;
  truncated: boolean;
}

const ago = (t: number) => {
  const d = Math.floor((Date.now() - t) / 86400000);
  return d < 1 ? "today" : d < 2 ? "yesterday" : d < 60 ? `${d} days ago` : d < 730 ? `${Math.round(d / 30.44)} months ago` : `${Math.round(d / 365.25)} years ago`;
};

export const CodeStatsPane = forwardRef<EditorPaneHandle, { path: string }>(function CodeStatsPane({ path }, ref) {
  const [scan, setScan] = useState<Scan | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(365);
  const [tab, setTab] = useState<Tab>("overview");

  const run = useCallback(async (sinceDays: number) => {
    const root = app().workspaceRoot();
    if (!root) return void setError("Open a folder first.");
    setBusy(true);
    setError(null);
    try {
      setProgress("Listing files…");
      const listed = await invoke<{ files: string[]; truncated?: boolean }>("fs_list_files", { root, limit: 20000, maxDepth: 20, workspace: currentWorkspaceEnv() });
      const wanted = listed.files.filter(isCounted);
      const files: FileStat[] = [];
      for (let i = 0; i < wanted.length; i += 32) {
        setProgress(`Counting lines… ${i} / ${wanted.length}`);
        const batch = await Promise.all(
          wanted.slice(i, i + 32).map(async (rel) => {
            const r = await native.readFile(`${root.replace(/[\\/]+$/, "")}/${rel}`).catch(() => null);
            const lang = languageOf(rel);
            if (!r || r.kind !== "text" || !lang) return null;
            return { path: rel, language: lang.name, bytes: r.size, ...countLines(r.content, lang) };
          }),
        );
        for (const f of batch) if (f) files.push(f);
      }
      setProgress("Reading git history…");
      let commits: Commit[] | null = null;
      let gitError: string | null = null;
      let prefix = "";
      const repo = await native.gitResolveRepo(root).catch(() => null);
      if (!repo) gitError = "This folder is not in a git repository, so there is no history to show.";
      else {
        const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
        const r = norm(repo.repoRoot);
        const w = norm(root);
        prefix = w.startsWith(r) && w !== r ? root.replace(/\\/g, "/").slice(repo.repoRoot.replace(/\\/g, "/").replace(/\/+$/, "").length + 1).replace(/\/+$/, "") + "/" : "";
        const out = await git(repo.repoRoot, logArgs(sinceDays, 5000), 90);
        if (!out.ok) gitError = (out.stderr || out.stdout).trim().slice(0, 300) || "git log failed";
        else {
          // Keep paths relative to the workspace, like the file list.
          commits = parseLog(out.stdout).map((c) => ({ ...c, files: c.files.filter((f) => !prefix || f.path.startsWith(prefix)).map((f) => ({ ...f, path: prefix ? f.path.slice(prefix.length) : f.path })) }));
        }
      }
      setScan({ root, files, commits, gitError, prefix, truncated: Boolean(listed.truncated) || listed.files.length >= 20000 });
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }, []);

  useEffect(() => void run(365), [run]);
  useImperativeHandle(ref, () => toolPaneHandle(path, { reload: () => (void run(days), true) }), [path, run, days]);

  const fileMap = useMemo(() => new Map((scan?.files ?? []).map((f) => [f.path, f])), [scan]);
  const exists = useCallback((p: string) => fileMap.has(p), [fileMap]);
  const langs = useMemo(() => byLanguage(scan?.files ?? []), [scan]);
  const changes: Churn[] = useMemo(() => (scan?.commits ? churn(scan.commits, exists) : []), [scan, exists]);
  const hot = useMemo(() => hotspots(changes, fileMap, 60), [changes, fileMap]);
  const pairs = useMemo(() => (scan?.commits ? coupling(scan.commits, { exists, limit: 60 }) : []), [scan, exists]);
  const people = useMemo(() => (scan?.commits ? contributors(scan.commits) : []), [scan]);
  const weeks = useMemo(() => (scan?.commits ? weeklyActivity(scan.commits).slice(-104) : []), [scan]);
  const totals = langs.reduce((a, l) => ({ code: a.code + l.code, comment: a.comment + l.comment, blank: a.blank + l.blank, files: a.files + l.files }), { code: 0, comment: 0, blank: 0, files: 0 });
  const bus = busFactor(changes);
  const largest = useMemo(() => [...(scan?.files ?? [])].sort((a, b) => b.code - a.code).slice(0, 60), [scan]);
  const maxWeek = Math.max(1, ...weeks.map((w) => w.commits));

  const open = (rel: string) => scan && app().openFile(`${scan.root.replace(/[\\/]+$/, "")}/${rel}`);
  const FileLink = ({ p }: { p: string }) => (
    <button type="button" className="min-w-0 truncate text-left font-mono text-[11.5px] hover:underline" title={p} onClick={() => open(p)}>
      {p}
    </button>
  );

  if (error) return <div className="p-6 text-[12.5px] text-red-500">{error}</div>;
  if (!scan) return <div className="p-6 text-[12.5px] text-muted-foreground">{progress || "Scanning…"}</div>;

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-2">
        {(
          [
            ["overview", "Overview"],
            ["hotspots", "Hotspots"],
            ["coupling", "Change together"],
            ["people", "People"],
            ["files", "Largest files"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button key={t} type="button" data-codestats-tab={t} className={cn(btn, tab === t && "bg-muted font-medium")} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
        <span className="flex-1" />
        <span className="text-muted-foreground">History</span>
        {PERIODS.map((p) => (
          <button key={p.days} type="button" className={cn(btn, days === p.days && "bg-muted font-medium")} disabled={busy} onClick={() => (setDays(p.days), void run(p.days))}>
            {p.label}
          </button>
        ))}
        <button type="button" className={btn} disabled={busy} onClick={() => void run(days)}>
          {busy ? progress || "Scanning…" : "Rescan"}
        </button>
      </div>
      {scan.gitError && tab !== "overview" && tab !== "files" && <div className="m-3 rounded bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-400">{scan.gitError}</div>}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === "overview" && (
          <div className="space-y-4" data-codestats-overview>
            <div className="flex flex-wrap gap-6">
              {[
                ["Lines of code", totals.code],
                ["Comment lines", totals.comment],
                ["Blank lines", totals.blank],
                ["Source files", totals.files],
                ...(scan.commits ? ([["Commits", scan.commits.length], ["People", people.length]] as [string, number][]) : []),
              ].map(([k, v]) => (
                <div key={k as string}>
                  <div className="text-[22px] font-semibold tabular-nums">{(v as number).toLocaleString()}</div>
                  <div className="text-muted-foreground">{k}</div>
                </div>
              ))}
              {scan.commits && bus > 0 && (
                <div title="How many people together made half of the changes in this period">
                  <div className={cn("text-[22px] font-semibold tabular-nums", bus < 2 && "text-amber-600")}>{bus}</div>
                  <div className="text-muted-foreground">Bus factor</div>
                </div>
              )}
            </div>
            {scan.truncated && <div className="text-amber-600">Only the first 20,000 files were counted.</div>}
            {totals.code > 0 && (
              <div className="flex h-3 overflow-hidden rounded" data-codestats-langbar>
                {langs.slice(0, 10).map((l, i) => (
                  <span key={l.language} className={LANG_COLORS[i]} style={{ width: `${(l.code / totals.code) * 100}%` }} title={`${l.language}: ${l.code.toLocaleString()} lines`} />
                ))}
              </div>
            )}
            <table className="w-full max-w-3xl border-collapse">
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr>
                  <th className="py-1 font-normal">Language</th>
                  <th className="py-1 text-right font-normal">Files</th>
                  <th className="py-1 text-right font-normal">Code</th>
                  <th className="py-1 text-right font-normal">Comments</th>
                  <th className="py-1 text-right font-normal">Blank</th>
                  <th className="py-1 text-right font-normal">Share</th>
                </tr>
              </thead>
              <tbody>
                {langs.map((l, i) => (
                  <tr key={l.language} className="border-b border-border/30" data-codestats-lang={l.language}>
                    <td className="py-0.5">
                      <span className={cn("mr-2 inline-block h-2 w-2 rounded-full", LANG_COLORS[i] ?? "bg-zinc-400")} />
                      {l.language}
                    </td>
                    <td className="py-0.5 text-right tabular-nums">{l.files.toLocaleString()}</td>
                    <td className="py-0.5 text-right tabular-nums">{l.code.toLocaleString()}</td>
                    <td className="py-0.5 text-right tabular-nums text-muted-foreground">{l.comment.toLocaleString()}</td>
                    <td className="py-0.5 text-right tabular-nums text-muted-foreground">{l.blank.toLocaleString()}</td>
                    <td className="py-0.5 text-right tabular-nums">{totals.code ? `${((l.code / totals.code) * 100).toFixed(1)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {weeks.length > 1 && (
              <div>
                <div className="mb-1 font-medium">Commits per week</div>
                <div className="flex h-20 items-end gap-px" data-codestats-weeks>
                  {weeks.map((w) => (
                    <span key={w.week} className="min-w-[2px] flex-1 rounded-t bg-emerald-500/70" style={{ height: `${(w.commits / maxWeek) * 100}%` }} title={`Week of ${new Date(w.week).toLocaleDateString()}: ${w.commits} commits`} />
                  ))}
                </div>
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>{new Date(weeks[0].week).toLocaleDateString()}</span>
                  <span>this week</span>
                </div>
              </div>
            )}
            {scan.gitError && <div className="text-muted-foreground">{scan.gitError}</div>}
          </div>
        )}

        {tab === "hotspots" && (
          <div className="space-y-2" data-codestats-hotspots>
            <div className="text-muted-foreground">Large files that change often — where bugs and slow reviews tend to collect. Score = commits × log(lines of code), relative to the top file.</div>
            {hot.length === 0 && <div className="text-muted-foreground">No changed source files in this period.</div>}
            {hot.map((h) => (
              <div key={h.path} className="flex items-center gap-3 border-b border-border/30 py-0.5" data-hotspot={h.path}>
                <span className="relative h-2 w-24 shrink-0 rounded bg-muted/50">
                  <span className={cn("absolute left-0 top-0 h-full rounded", h.score > 66 ? "bg-red-500" : h.score > 33 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${h.score}%` }} />
                </span>
                <span className="w-8 text-right tabular-nums">{h.score}</span>
                <FileLink p={h.path} />
                <span className="flex-1" />
                <span className="shrink-0 tabular-nums text-muted-foreground">{h.commits} commits</span>
                <span className="w-24 shrink-0 text-right tabular-nums text-muted-foreground">{h.code.toLocaleString()} lines</span>
                <span className={cn("w-48 shrink-0 truncate text-right", h.ownership >= 0.9 && h.commits >= 5 ? "text-amber-600" : "text-muted-foreground")} title={`${h.authors} people changed this file`}>
                  {Math.round(h.ownership * 100)}% {h.mainAuthor}
                </span>
              </div>
            ))}
          </div>
        )}

        {tab === "coupling" && (
          <div className="space-y-2" data-codestats-coupling>
            <div className="text-muted-foreground">Files that keep changing in the same commits (at least 3 times). When they are not obviously related, the link between them is hidden — a candidate for refactoring or for a test. Commits touching more than 30 files are ignored.</div>
            {pairs.length === 0 && <div className="text-muted-foreground">No files changed together often enough in this period.</div>}
            {pairs.map((p) => (
              <div key={`${p.a}|${p.b}`} className="flex items-center gap-3 border-b border-border/30 py-0.5" data-coupling>
                <span className="w-12 shrink-0 text-right tabular-nums">{Math.round(p.degree * 100)}%</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <FileLink p={p.a} />
                  <FileLink p={p.b} />
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">together {p.together}×</span>
              </div>
            ))}
          </div>
        )}

        {tab === "people" && (
          <table className="w-full border-collapse" data-codestats-people>
            <thead className="text-left text-[11px] text-muted-foreground">
              <tr>
                <th className="py-1 font-normal">Person</th>
                <th className="py-1 text-right font-normal">Commits</th>
                <th className="py-1 text-right font-normal">Lines added</th>
                <th className="py-1 text-right font-normal">Lines removed</th>
                <th className="py-1 text-right font-normal">Files</th>
                <th className="py-1 text-right font-normal">First</th>
                <th className="py-1 text-right font-normal">Latest</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.name} className="border-b border-border/30">
                  <td className="py-0.5">{p.name}</td>
                  <td className="py-0.5 text-right tabular-nums">{p.commits.toLocaleString()}</td>
                  <td className="py-0.5 text-right tabular-nums text-emerald-600">+{p.added.toLocaleString()}</td>
                  <td className="py-0.5 text-right tabular-nums text-red-500">−{p.deleted.toLocaleString()}</td>
                  <td className="py-0.5 text-right tabular-nums">{p.files.toLocaleString()}</td>
                  <td className="py-0.5 text-right text-muted-foreground">{ago(p.first)}</td>
                  <td className="py-0.5 text-right text-muted-foreground">{ago(p.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === "files" && (
          <div data-codestats-files>
            {largest.map((f) => (
              <div key={f.path} className="flex items-center gap-3 border-b border-border/30 py-0.5">
                <span className="w-20 shrink-0 text-right tabular-nums">{f.code.toLocaleString()}</span>
                <FileLink p={f.path} />
                <span className="flex-1" />
                <span className="shrink-0 text-muted-foreground">{f.language}</span>
                <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">{formatBytes(f.bytes)}</span>
                <span className="w-28 shrink-0 text-right text-muted-foreground">{changes.find((c) => c.path === f.path)?.commits ?? 0} commits</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

export const CODESTATS_ACTIONS = [
  { id: "codestats.open", label: "Code stats: Lines of code, hotspots and who changes what", keywords: ["cloc", "lines of code", "loc", "statistics", "hotspots", "churn", "coupling", "contributors", "bus factor", "git history", "languages"], run: openCodeStats },
];
