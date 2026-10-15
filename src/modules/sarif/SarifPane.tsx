// .sarif files (or gear-sarif://<file>): static analysis results from CodeQL,
// Semgrep, ESLint, Trivy and friends, grouped by rule, file or severity, with
// the rule's help, the source-to-sink path, a comparison with a baseline
// scan, and every location one click from the editor.

import { invoke } from "@tauri-apps/api/core";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { toast } from "sonner";
import { app, frontFilePath } from "@/app/appBridge";
import { openExternalUrl } from "@/lib/external-link";
import { cn } from "@/lib/utils";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { inputBox, quickPick } from "@/modules/quick-pick";
import { base64ToBytes, copyToClipboard, formatBytes, toolPaneHandle, toolsNative } from "@/modules/tools/paneHandle";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { compare, filterFindings, groupFindings, parseSarif, SEVERITY_ORDER, toMarkdown, type Comparison, type Finding, type GroupBy, type Location, type SarifLog, type Severity } from "./model";

const SCHEME = "gear-sarif://";
const READ_CAP = 128 * 1024 * 1024;
const SARIF = /\.sarif(\.json)?$/i;
const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const SEV_STYLE: Record<Severity, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-red-500/15 text-red-600",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  low: "bg-sky-500/15 text-sky-600",
  info: "bg-muted text-muted-foreground",
};

export function openSarifFor(file: string): void {
  app().openFile(/\.sarif$/i.test(file) ? file : `${SCHEME}${file}`);
}

export async function openSarifViewer(): Promise<void> {
  const current = frontFilePath() ?? getActiveEditor()?.path ?? "";
  const root = app().workspaceRoot();
  const items: { label: string; description?: string; value: string }[] = [];
  if (SARIF.test(current)) items.push({ label: current.split(/[\\/]/).pop() ?? current, description: "Current file", value: current });
  if (root) {
    const listed = await invoke<{ files: string[] }>("fs_list_files", { root, limit: 30000, maxDepth: 12, workspace: currentWorkspaceEnv() }).catch(() => ({ files: [] as string[] }));
    for (const f of listed.files.map((x) => x.replace(/\\/g, "/"))) if (SARIF.test(f) && !/(^|\/)node_modules\//.test(f)) items.push({ label: f, value: `${root.replace(/[\\/]+$/, "")}/${f}` });
  }
  items.push({ label: "Other file…", value: "" });
  const pick = items.length > 1 ? await quickPick(items, { title: "Open static analysis results (SARIF)" }) : "";
  if (pick === undefined) return;
  const file = pick || (await inputBox({ title: "Open a SARIF file", placeholder: "Path to a .sarif file (codeql database analyze --format=sarif-latest, semgrep --sarif, eslint -f sarif …)" }))?.trim();
  if (file) openSarifFor(file);
}

async function readText(path: string): Promise<string> {
  const r = await toolsNative.readBytes(path, READ_CAP);
  if (r.truncated) throw new Error(`${path.split(/[\\/]/).pop()} is ${formatBytes(r.size)}; files over ${formatBytes(READ_CAP)} are not opened.`);
  return new TextDecoder().decode(base64ToBytes(r.data));
}

type View = "all" | "new" | "fixed";
const where = (l: Location) => (l.path ? `${l.path}${l.line ? `:${l.line}` : ""}${l.column ? `:${l.column}` : ""}` : "(no location)");

export const SarifPane = forwardRef<EditorPaneHandle, { path: string }>(function SarifPane({ path }, ref) {
  const file = path.startsWith(SCHEME) ? path.slice(SCHEME.length) : path;
  const [log, setLog] = useState<SarifLog | null>(null);
  const [baseline, setBaseline] = useState<{ file: string; log: SarifLog } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [severities, setSeverities] = useState<Set<Severity>>(new Set());
  const [tool, setTool] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("rule");
  const [showSuppressed, setShowSuppressed] = useState(false);
  const [view, setView] = useState<View>("all");
  const [selected, setSelected] = useState<Finding | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      setLog(parseSarif(await readText(file), app().workspaceRoot()));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [file]);
  useEffect(() => void load(), [load]);
  useImperativeHandle(ref, () => toolPaneHandle(path, { setQuery: setText, clearQuery: () => setText(""), reload: () => (void load(), true) }), [path, load]);

  const cmp: Comparison | null = useMemo(() => (log && baseline ? compare(log.findings, baseline.log.findings) : null), [log, baseline]);
  const source = useMemo(() => (!log ? [] : view === "new" && cmp ? cmp.added : view === "fixed" && cmp ? cmp.fixed : log.findings), [log, cmp, view]);
  const filtered = useMemo(() => filterFindings(source, { text, severities, tool, showSuppressed }), [source, text, severities, tool, showSuppressed]);
  const groups = useMemo(() => groupFindings(filtered, groupBy), [filtered, groupBy]);
  const counts = useMemo(() => {
    const m = new Map<Severity, number>();
    for (const f of filterFindings(source, { text: "", severities: new Set(), tool, showSuppressed })) m.set(f.severity, (m.get(f.severity) ?? 0) + 1);
    return m;
  }, [source, tool, showSuppressed]);
  const suppressedCount = useMemo(() => source.filter((f) => f.suppressed).length, [source]);

  const root = app().workspaceRoot();
  const openLoc = (l: Location) => {
    if (!l.path) return;
    const abs = /^([a-z]:)?\//i.test(l.path) ? l.path : root ? `${root.replace(/[\\/]+$/, "")}/${l.path}` : l.path;
    app().openFile(abs, l.line ?? undefined, l.column ?? undefined);
  };

  const chooseBaseline = async () => {
    const dir = file.replace(/[\\/][^\\/]*$/, "");
    const p = (await inputBox({ title: "Compare with an earlier scan", value: `${dir}/`, placeholder: "Path to the baseline .sarif (e.g. the scan from main)" }))?.trim();
    if (!p) return;
    try {
      setBaseline({ file: p, log: parseSarif(await readText(p), root) });
      setView("new");
    } catch (err) {
      toast.error(`Could not read the baseline: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (error) return <div className="p-6 text-[12.5px] text-red-500" data-sarif-error>{error}</div>;
  if (!log) return <div className="p-6 text-[12.5px] text-muted-foreground">Reading…</div>;

  const toggleSev = (s: Severity) => setSeverities((cur) => (cur.has(s) ? new Set([...cur].filter((x) => x !== s)) : new Set([...cur, s])));
  const sel = selected && filtered.includes(selected) ? selected : null;

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-2">
        <span className="text-muted-foreground" data-sarif-summary>
          {log.tools.map((t) => `${t.name}${t.version ? ` ${t.version}` : ""}`).join(", ")} · {log.findings.length} finding{log.findings.length === 1 ? "" : "s"}
          {suppressedCount > 0 && ` (${suppressedCount} suppressed)`}
        </span>
        <span className="flex-1" />
        <input className="w-48 rounded border border-border/60 bg-transparent px-2 py-0.5 text-[12px]" placeholder="Filter rule, file, message, CWE…" value={text} onChange={(e) => setText(e.target.value)} />
        <select className="rounded border border-border/60 bg-transparent px-1 py-0.5 text-[12px]" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} title="Group by">
          <option value="rule">By rule</option>
          <option value="file">By file</option>
          <option value="severity">By severity</option>
        </select>
        {log.tools.length > 1 && (
          <select className="rounded border border-border/60 bg-transparent px-1 py-0.5 text-[12px]" value={tool ?? ""} onChange={(e) => setTool(e.target.value || null)}>
            <option value="">All tools</option>
            {log.tools.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1 text-[11.5px]">
          <input type="checkbox" checked={showSuppressed} onChange={(e) => setShowSuppressed(e.target.checked)} /> Suppressed
        </label>
        <button type="button" className={btn} onClick={() => void chooseBaseline()} data-sarif-baseline>
          {baseline ? "Other baseline…" : "Compare with baseline…"}
        </button>
        <button type="button" className={btn} onClick={() => void copyToClipboard(toMarkdown(log, filtered, view === "all" ? cmp : null)).then(() => toast.success("Summary copied as Markdown"))}>
          Copy summary
        </button>
        <button type="button" className={btn} onClick={() => void load()}>
          Reload
        </button>
      </div>
      {log.notes.length > 0 && <div className="border-b border-border/60 bg-amber-500/10 px-3 py-1 text-amber-700 dark:text-amber-400">{log.notes.slice(0, 3).join(" · ")}{log.notes.length > 3 && ` · …${log.notes.length - 3} more tool errors`}</div>}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-2 py-1.5">
        {cmp && (
          <span className="mr-2 flex items-center gap-1" data-sarif-compare>
            {(["new", "fixed", "all"] as View[]).map((v) => (
              <button key={v} type="button" className={cn("rounded px-1.5 py-0.5 text-[11.5px]", view === v ? "bg-primary/15 text-primary" : "hover:bg-muted")} onClick={() => setView(v)}>
                {v === "new" ? `New ${cmp.added.length}` : v === "fixed" ? `Fixed ${cmp.fixed.length}` : `All ${log.findings.length}`}
              </button>
            ))}
            <span className="text-[11px] text-muted-foreground" title={baseline?.file}>
              vs {baseline?.file.split(/[\\/]/).pop()} · {cmp.unchanged.length} unchanged
            </span>
          </span>
        )}
        {SEVERITY_ORDER.filter((s) => counts.get(s)).map((s) => (
          <button key={s} type="button" data-sarif-sev={s} className={cn("rounded px-1.5 py-0.5 text-[11.5px] capitalize", SEV_STYLE[s], severities.size > 0 && !severities.has(s) && "opacity-40")} onClick={() => toggleSev(s)} title="Show only these (click several to combine)">
            {s} {counts.get(s)}
          </button>
        ))}
        {severities.size > 0 && (
          <button type="button" className="text-[11.5px] text-muted-foreground underline" onClick={() => setSeverities(new Set())}>
            all severities
          </button>
        )}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-[3] overflow-auto">
          {groups.length === 0 && <div className="p-4 text-emerald-600" data-sarif-empty>{log.findings.length ? "Nothing matches the filters." : "This scan found nothing."}</div>}
          {groups.map((g) => {
            const first = g.findings[0];
            const isOpen = !collapsed.has(g.key);
            return (
              <div key={g.key} data-sarif-group={g.key}>
                <button type="button" className="sticky top-0 flex w-full items-center gap-2 border-b border-border/40 bg-background px-2 py-1 text-left hover:bg-muted/50" onClick={() => setCollapsed((c) => (c.has(g.key) ? new Set([...c].filter((x) => x !== g.key)) : new Set([...c, g.key])))}>
                  <span className="w-3 text-muted-foreground">{isOpen ? "▾" : "▸"}</span>
                  {groupBy === "severity" ? <span className={cn("rounded px-1 text-[10.5px] capitalize", SEV_STYLE[g.key as Severity])}>{g.key}</span> : <span className="truncate font-mono text-[12px] font-medium">{g.key}</span>}
                  {groupBy === "rule" && first.rule?.short && <span className="truncate text-muted-foreground">{first.rule.short}</span>}
                  <span className="ml-auto shrink-0 rounded bg-muted px-1.5 text-[11px] tabular-nums">{g.findings.length}</span>
                </button>
                {isOpen &&
                  g.findings.map((f) => (
                    <button
                      key={`${f.tool}-${f.index}-${view}`}
                      type="button"
                      data-sarif-finding={f.ruleId}
                      className={cn("flex w-full items-baseline gap-2 py-0.5 pl-7 pr-2 text-left hover:bg-muted/50", sel === f && "bg-primary/10", f.suppressed && "opacity-60")}
                      onClick={() => setSelected(f)}
                      onDoubleClick={() => openLoc(f.location)}
                    >
                      <span className={cn("shrink-0 rounded px-1 text-[10px] capitalize", SEV_STYLE[f.severity])}>{f.severity}</span>
                      <span className="min-w-0 flex-1 truncate">{f.message}</span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{groupBy === "file" ? (f.location.line ? `:${f.location.line}` : "") : groupBy === "rule" ? where(f.location) : `${f.ruleId} · ${where(f.location)}`}</span>
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
        <div className="min-w-0 flex-[2] overflow-auto border-l border-border/60 p-3" data-sarif-detail>
          {!sel ? (
            <div className="text-muted-foreground">Select a finding to see its rule, its path through the code and how to fix it. Double-click a finding to open its location.</div>
          ) : (
            <Detail f={sel} openLoc={openLoc} />
          )}
        </div>
      </div>
    </div>
  );
});

function Detail({ f, openLoc }: { f: Finding; openLoc: (l: Location) => void }) {
  const r = f.rule;
  const LocLink = ({ l, label }: { l: Location; label?: string }) => (
    <button type="button" className="font-mono text-[11.5px] text-primary hover:underline disabled:text-muted-foreground disabled:no-underline" disabled={!l.path} onClick={() => openLoc(l)}>
      {label ?? where(l)}
    </button>
  );
  return (
    <div className="space-y-3">
      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn("rounded px-1 text-[10.5px] capitalize", SEV_STYLE[f.severity])}>{f.severity}</span>
          <span className="font-mono font-medium">{f.ruleId}</span>
          <span className="text-[11px] text-muted-foreground">
            {f.tool} · level {f.level}
            {r?.securitySeverity !== null && r?.securitySeverity !== undefined && ` · security severity ${r.securitySeverity}`}
            {r?.precision && ` · ${r.precision} precision`}
            {f.suppressed && " · suppressed"}
          </span>
        </div>
        {r?.short && <div className="mt-1 font-medium">{r.short}</div>}
        <div className="mt-1 whitespace-pre-wrap">{f.message}</div>
        <div className="mt-1">
          <LocLink l={f.location} />
        </div>
        {f.location.snippet && <pre className="mt-1 overflow-auto rounded bg-muted/50 p-2 font-mono text-[11.5px]">{f.location.snippet}</pre>}
      </div>
      {r && r.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {r.tags.map((t) => {
            const cwe = /cwe[-/](\d+)/i.exec(t);
            return cwe ? (
              <button key={t} type="button" className="rounded bg-muted px-1 text-[10.5px] text-primary hover:underline" onClick={() => void openExternalUrl(`https://cwe.mitre.org/data/definitions/${Number(cwe[1])}.html`)}>
                CWE-{Number(cwe[1])}
              </button>
            ) : (
              <span key={t} className="rounded bg-muted px-1 text-[10.5px]">
                {t}
              </span>
            );
          })}
        </div>
      )}
      {f.flows.map((flow, i) => (
        <div key={i} data-sarif-flow>
          <div className="mb-1 text-[11.5px] font-medium text-muted-foreground">
            Path {f.flows.length > 1 ? `${i + 1} of ${f.flows.length}` : ""} · {flow.length} steps, source to sink
          </div>
          <ol className="space-y-0.5 border-l-2 border-primary/30 pl-3">
            {flow.map((s, k) => (
              <li key={k} className="flex items-baseline gap-2">
                <span className="w-5 shrink-0 text-right text-[11px] text-muted-foreground">{k + 1}</span>
                <LocLink l={s} />
                {s.message && <span className="truncate text-muted-foreground">{s.message}</span>}
              </li>
            ))}
          </ol>
        </div>
      ))}
      {f.related.length > 0 && (
        <div>
          <div className="mb-1 text-[11.5px] font-medium text-muted-foreground">Related locations</div>
          {f.related.map((l, i) => (
            <div key={i} className="flex items-baseline gap-2">
              <LocLink l={l} />
              {l.message && <span className="truncate text-muted-foreground">{l.message}</span>}
            </div>
          ))}
        </div>
      )}
      {(r?.help || r?.full) && (
        <div>
          <div className="mb-1 text-[11.5px] font-medium text-muted-foreground">About this rule</div>
          <div className="whitespace-pre-wrap text-[12px] leading-relaxed">{(r.help ?? r.full ?? "").slice(0, 6000)}</div>
        </div>
      )}
      {r?.helpUri && (
        <button type="button" className="text-[12px] text-primary hover:underline" onClick={() => void openExternalUrl(r.helpUri as string)}>
          Rule documentation ↗
        </button>
      )}
    </div>
  );
}

export const SARIF_ACTIONS = [
  { id: "sarif.open", label: "SARIF: Open static analysis results (CodeQL, Semgrep, ESLint, Trivy…)", keywords: ["sarif", "codeql", "semgrep", "static analysis", "security", "sast", "scan", "findings", "code scanning", "trivy", "bandit"], run: () => void openSarifViewer() },
];
