// gear-deps://: every project's dependencies with current / wanted / latest,
// update size, vulnerabilities (with advisories), and upgrade buttons.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { openExternalUrl } from "@/lib/external-link";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { compareVersions, SEVERITY_RANK, updateKind, worstSeverity, type Dep, type Severity, type UpdateKind } from "./model";
import { DEPS_PATH, safeUpdates, scan, scanAll, upgrade, useDepsStore, type Project } from "./store";

const KIND_STYLE: Record<UpdateKind, string> = { major: "bg-red-500/15 text-red-500", minor: "bg-amber-500/15 text-amber-600", patch: "bg-emerald-500/15 text-emerald-600", prerelease: "bg-muted text-muted-foreground" };
const SEV_STYLE: Record<Severity, string> = { critical: "bg-red-600 text-white", high: "bg-red-500/20 text-red-500", moderate: "bg-amber-500/20 text-amber-600", low: "bg-sky-500/15 text-sky-600", unknown: "bg-muted text-foreground" };

type Filter = "attention" | "outdated" | "vulnerable" | "all";

function Badge({ kind }: { kind: UpdateKind | null }) {
  return kind ? <span className={cn("rounded px-1 text-[10.5px]", KIND_STYLE[kind])}>{kind}</span> : null;
}

function DepRow({ p, d }: { p: Project; d: Dep }) {
  const [open, setOpen] = useState(false);
  const busy = useDepsStore((s) => Boolean(s.busy[p.dir]));
  const wantedKind = updateKind(d.current, d.wanted);
  const latestKind = updateKind(d.current, d.latest);
  const worst = worstSeverity(d.vulns);
  // The smallest release that fixes every advisory, when the source says so.
  const fix = d.vulns.flatMap((v) => v.fixedIn ?? []).filter((v) => compareVersions(v, d.current) > 0).sort(compareVersions).pop();
  return (
    <>
      <tr className="border-b border-border/30 hover:bg-muted/30">
        <td className="py-1 pl-3 pr-2">
          <span className="font-medium">{d.name}</span>
          {d.kind !== "prod" && <span className="ml-1.5 text-[10.5px] text-muted-foreground">{d.kind}</span>}
          {d.deprecated && <span className="ml-1.5 rounded bg-amber-500/15 px-1 text-[10.5px] text-amber-600">deprecated</span>}
        </td>
        <td className="px-2 font-mono tabular-nums">{d.current}</td>
        <td className="px-2 font-mono tabular-nums">{wantedKind ? d.wanted : <span className="text-muted-foreground">—</span>}</td>
        <td className="px-2 font-mono tabular-nums">
          {latestKind ? (
            <>
              {d.latest} <Badge kind={latestKind} />
            </>
          ) : (
            <span className="text-muted-foreground">{d.latest ? "up to date" : "—"}</span>
          )}
        </td>
        <td className="px-2">
          {worst && (
            <button type="button" className={cn("rounded px-1.5 text-[11px]", SEV_STYLE[worst])} onClick={() => setOpen((o) => !o)}>
              {d.vulns.length} {worst}
            </button>
          )}
        </td>
        <td className="whitespace-nowrap px-2 py-1 text-right">
          {wantedKind && (
            <button type="button" disabled={busy} className="mr-1 rounded border border-border/60 px-1.5 text-[11px] hover:bg-muted disabled:opacity-40" onClick={() => void upgrade(p.dir, [{ dep: d, version: d.wanted! }])} title="Newest version the declared range allows">
              → {d.wanted}
            </button>
          )}
          {latestKind && d.latest !== d.wanted && (
            <button type="button" disabled={busy} className="rounded border border-border/60 px-1.5 text-[11px] hover:bg-muted disabled:opacity-40" onClick={() => void upgrade(p.dir, [{ dep: d, version: d.latest! }])}>
              → {d.latest}
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border/30 bg-muted/20">
          <td colSpan={6} className="px-6 py-2">
            {fix && <div className="mb-1 text-[11.5px]">Fixed in {fix} and later.</div>}
            {[...d.vulns]
              .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
              .map((v) => (
                <div key={v.id} className="flex items-baseline gap-2 py-0.5 text-[11.5px]">
                  <span className={cn("shrink-0 rounded px-1 text-[10.5px]", SEV_STYLE[v.severity])}>{v.severity}</span>
                  <button type="button" className="shrink-0 font-mono text-primary hover:underline" onClick={() => void openExternalUrl(v.url)}>
                    {v.id}
                  </button>
                  <span className="min-w-0">{v.title}</span>
                  {v.via && <span className="shrink-0 text-muted-foreground">via {v.via}</span>}
                  {v.range && <span className="shrink-0 font-mono text-muted-foreground">{v.range}</span>}
                </div>
              ))}
          </td>
        </tr>
      )}
    </>
  );
}

function ProjectSection({ p, filter }: { p: Project; filter: Filter }) {
  const busy = useDepsStore((s) => Boolean(s.busy[p.dir]));
  const rows = useMemo(() => {
    const keep = (d: Dep) => {
      const outdated = Boolean(updateKind(d.current, d.latest) || updateKind(d.current, d.wanted));
      if (filter === "outdated") return outdated;
      if (filter === "vulnerable") return d.vulns.length > 0;
      if (filter === "attention") return d.vulns.length > 0 || (outdated && d.kind !== "indirect");
      return true;
    };
    return p.deps.filter(keep).sort((a, b) => SEVERITY_RANK[worstSeverity(b.vulns) ?? "unknown"] - SEVERITY_RANK[worstSeverity(a.vulns) ?? "unknown"] || b.vulns.length - a.vulns.length || a.name.localeCompare(b.name));
  }, [p.deps, filter]);
  const safe = safeUpdates(p);
  const vulnCount = p.deps.reduce((n, d) => n + d.vulns.length, 0);
  return (
    <section className="mb-4 rounded-md border border-border/60">
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <span className="font-medium">{p.label}</span>
        <span className="truncate text-[11px] text-muted-foreground">{p.dir}</span>
        <span className="flex-1" />
        {p.status === "ready" && (
          <span className="text-[11px] text-muted-foreground">
            {p.deps.filter((d) => updateKind(d.current, d.latest)).length} outdated · {vulnCount} advisories
          </span>
        )}
        {safe.length > 0 && (
          <button type="button" disabled={busy} className="rounded bg-primary px-2 py-0.5 text-[11.5px] text-primary-foreground disabled:opacity-50" onClick={() => void upgrade(p.dir, safe)}>
            Update {safe.length} patch / minor
          </button>
        )}
        <button type="button" className="rounded px-2 py-0.5 text-[11.5px] hover:bg-muted" disabled={p.status === "scanning" || busy} onClick={() => void scan(p.dir)}>
          {p.status === "scanning" ? "Scanning…" : busy ? "Updating…" : "Rescan"}
        </button>
      </header>
      {p.status === "error" && <div className="whitespace-pre-wrap px-3 py-2 text-[12px] text-destructive">{p.error}</div>}
      {p.auditError && <div className="px-3 py-1 text-[11px] text-amber-600">Vulnerability check incomplete: {p.auditError}</div>}
      {p.status === "ready" && !rows.length && <div className="px-3 py-2 text-[12px] text-muted-foreground">{filter === "all" ? "No dependencies found." : "Nothing needs attention."}</div>}
      {rows.length > 0 && (
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border/40 text-left text-[11px] text-muted-foreground">
              <th className="py-1 pl-3 pr-2 font-normal">Package</th>
              <th className="px-2 font-normal">Current</th>
              <th className="px-2 font-normal">In range</th>
              <th className="px-2 font-normal">Latest</th>
              <th className="px-2 font-normal">Advisories</th>
              <th className="px-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <DepRow key={d.name} p={p} d={d} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export const DepsPane = forwardRef<EditorPaneHandle, { path: string }>(function DepsPane({ path }, ref) {
  const projects = useDepsStore((s) => s.projects);
  const root = useDepsStore((s) => s.root);
  const discovered = useDepsStore((s) => s.discovered);
  const log = useDepsStore((s) => s.log);
  const [filter, setFilter] = useState<Filter>("attention");
  const [showLog, setShowLog] = useState(false);
  useEffect(() => {
    if (!projects.length) void scanAll();
  }, [projects.length]);
  useImperativeHandle(
    ref,
    () =>
      ({
        setQuery: () => {},
        findNext: () => {},
        findPrevious: () => {},
        clearQuery: () => {},
        focus: () => {},
        getSelection: () => null,
        getPath: () => path,
        reload: () => (void scanAll(), true),
        gotoLine: () => {},
        undo: () => {},
        redo: () => {},
        openFindReplace: () => {},
        toggleBlame: () => {},
        save: async () => {},
      }) as EditorPaneHandle,
    [path],
  );
  const chip = (on: boolean) => cn("rounded px-2 py-0.5 text-[11.5px]", on ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted");
  return (
    <div className="flex h-full flex-col text-[12px]">
      <div className="flex items-center gap-1.5 border-b border-border/60 px-3 py-1.5">
        <span className="font-medium">Dependencies</span>
        <span className="truncate text-[11px] text-muted-foreground">{root}</span>
        <span className="flex-1" />
        {(["attention", "outdated", "vulnerable", "all"] as Filter[]).map((f) => (
          <button key={f} type="button" className={chip(filter === f)} onClick={() => setFilter(f)}>
            {f === "attention" ? "Needs attention" : f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
        <button type="button" className={chip(showLog)} onClick={() => setShowLog((x) => !x)}>
          Output
        </button>
        <button type="button" className="rounded px-2 py-0.5 text-[11.5px] hover:bg-muted" onClick={() => void scanAll()}>
          Rescan all
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!root && <div className="text-muted-foreground">Open a folder to see its dependencies.</div>}
        {root && !projects.length && (
          <div className="text-muted-foreground">
            {discovered
              ? "No package.json, Cargo.toml, pyproject.toml, requirements.txt or go.mod in this folder."
              : "Looking for package.json, Cargo.toml, pyproject.toml / requirements.txt and go.mod…"}
          </div>
        )}
        {projects.map((p) => (
          <ProjectSection key={`${p.eco}:${p.dir}`} p={p} filter={filter} />
        ))}
      </div>
      {showLog && <pre className="h-48 shrink-0 overflow-auto border-t border-border/60 p-2 font-mono text-[11.5px]">{log || "No upgrades run yet."}</pre>}
    </div>
  );
});

export const isDepsPath = (p: string) => p === DEPS_PATH;
