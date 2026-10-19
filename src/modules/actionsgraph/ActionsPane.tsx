// gear-actions://: the workspace's GitHub Actions workflows as job graphs,
// with matrices expanded, and a simulator that shows which workflows and
// jobs an event would start — and why the others would not.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { toolPaneHandle } from "@/modules/tools/paneHandle";
import { levels, parseWorkflow, simulate, type Job, type SimEvent, type Verdict, type Workflow } from "./model";

const PATH = "gear-actions://Workflows";
const DIR = ".github/workflows";
const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const field = "rounded border border-border/60 bg-transparent px-2 py-0.5 text-[12px]";
const CARD_W = 190;
const CARD_H = 58;
const GAP_X = 56;
const GAP_Y = 16;
const EVENTS = ["push", "pull_request", "pull_request_target", "workflow_dispatch", "schedule", "release", "merge_group", "workflow_call"];
const VERDICT_STYLE: Record<Verdict, string> = { runs: "text-emerald-600", skipped: "text-muted-foreground line-through", maybe: "text-amber-600" };

export function openActionsGraph(): void {
  app().openFile(PATH);
}

async function git(root: string, cmd: string): Promise<string | null> {
  const r = await native.runCommand(cmd, root, 30).catch(() => null);
  return r && r.exit_code === 0 ? r.stdout : null;
}

export const ActionsPane = forwardRef<EditorPaneHandle, { path: string }>(function ActionsPane({ path }, ref) {
  const [flows, setFlows] = useState<Workflow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | "simulate">("simulate");
  const [job, setJob] = useState<string | null>(null);
  const [ev, setEv] = useState<SimEvent>({ name: "push", branch: "main", tag: null, type: "opened", changedFiles: [] });
  const [filesText, setFilesText] = useState("");
  const root = app().workspaceRoot() ?? "";

  const load = useCallback(async () => {
    setError(null);
    try {
      if (!root) throw new Error("Open a folder first.");
      const base = `${root.replace(/[\\/]+$/, "")}/${DIR}`;
      const entries = await native.readDirAll(base).catch(() => []);
      const out: Workflow[] = [];
      for (const e of entries.filter((x) => x.kind === "file" && /\.ya?ml$/i.test(x.name)).sort((a, b) => a.name.localeCompare(b.name))) {
        const r = await native.readFile(`${base}/${e.name}`).catch(() => null);
        if (r && r.kind === "text") out.push(parseWorkflow(r.content, `${DIR}/${e.name}`));
      }
      setFlows(out);
      // Simulate the current branch with what changed on it.
      const branch = (await git(root, "git rev-parse --abbrev-ref HEAD"))?.trim() || "main";
      const head = (await git(root, "git symbolic-ref --short refs/remotes/origin/HEAD"))?.trim().replace(/^origin\//, "");
      const baseBranch = head || ((await git(root, "git rev-parse --verify --quiet main")) !== null ? "main" : "master");
      const changed = new Set<string>();
      for (const cmd of [`git diff --name-only ${baseBranch}...HEAD`, "git diff --name-only HEAD"]) (await git(root, cmd))?.split(/\r?\n/).forEach((f) => f.trim() && changed.add(f.trim()));
      const files = [...changed].sort();
      setFilesText(files.join("\n"));
      setEv((cur) => ({ ...cur, branch: branch === "HEAD" ? baseBranch : branch, changedFiles: files }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [root]);
  useEffect(() => void load(), [load]);
  useImperativeHandle(ref, () => toolPaneHandle(path, { reload: () => (void load(), true) }), [path, load]);

  const results = useMemo(() => (flows ? simulate(flows, ev) : []), [flows, ev]);
  const wf = flows?.find((f) => f.file === selected) ?? null;
  const openWorkflow = (file: string, needle?: string) => {
    const full = `${root.replace(/[\\/]+$/, "")}/${file}`;
    if (!needle) return app().openFile(full);
    void native.readFile(full).then((r) => {
      const line = r.kind === "text" ? r.content.split(/\r?\n/).findIndex((l) => new RegExp(`^\\s+${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*$`).test(l)) + 1 : 0;
      app().openFile(full, line || 1, 1);
    });
  };

  if (error) return <div className="p-6 text-[12.5px] text-red-500">{error}</div>;
  if (!flows) return <div className="p-6 text-[12.5px] text-muted-foreground">Reading workflows…</div>;
  if (!flows.length) return <div className="p-6 text-[12.5px] text-muted-foreground" data-actions-empty>No workflows in {DIR}.</div>;

  return (
    <div className="flex h-full text-[12.5px]">
      <div className="w-60 shrink-0 overflow-auto border-r border-border/60 py-1">
        <button type="button" data-actions-nav="simulate" className={cn("flex w-full px-2 py-1 text-left font-medium hover:bg-muted/50", selected === "simulate" && "bg-primary/10")} onClick={() => setSelected("simulate")}>
          What runs when…
        </button>
        <div className="mt-1 px-2 text-[11px] text-muted-foreground">Workflows</div>
        {flows.map((f) => {
          const r = results.find((x) => x.workflow === f);
          return (
            <button key={f.file} type="button" data-actions-nav={f.file} className={cn("flex w-full items-baseline gap-1.5 px-2 py-0.5 text-left hover:bg-muted/50", selected === f.file && "bg-primary/10")} onClick={() => {
                setSelected(f.file);
                setJob(null);
              }}>
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", r?.runs ? "bg-emerald-500" : "bg-muted-foreground/40")} title={r?.runs ? `Runs on this ${ev.name}` : r?.reason} />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              {f.problems.length > 0 && <span className="rounded bg-red-500/15 px-1 text-[10px] text-red-600">{f.problems.length}</span>}
            </button>
          );
        })}
      </div>
      <div className="min-w-0 flex-1 overflow-auto">
        {selected === "simulate" ? (
          <Simulator ev={ev} setEv={setEv} filesText={filesText} setFilesText={setFilesText} results={results} onOpen={(f) => {
              setSelected(f);
              setJob(null);
            }} />
        ) : wf ? (
          <div className="p-3">
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <span className="font-medium">{wf.name}</span>
              <button type="button" className="font-mono text-[11.5px] text-muted-foreground hover:underline" onClick={() => openWorkflow(wf.file)}>
                {wf.file}
              </button>
              <span className="text-muted-foreground">
                on: {wf.triggers.map((t) => `${t.event}${t.filters.branches ? ` [${t.filters.branches.join(", ")}]` : ""}${t.filters.tags ? ` tags [${t.filters.tags.join(", ")}]` : ""}${t.details.length ? ` (${t.details.join(", ")})` : ""}`).join(" · ")}
              </span>
              <span className="flex-1" />
              <button type="button" className={btn} onClick={() => void load()}>
                Reload
              </button>
            </div>
            {wf.problems.map((p) => (
              <div key={p} className="text-red-600" data-actions-problem>
                {p}
              </div>
            ))}
            <Graph wf={wf} selected={job} onSelect={setJob} verdicts={results.find((r) => r.workflow === wf)?.jobs} />
            {job && wf.jobs.find((j) => j.id === job) && <JobDetail job={wf.jobs.find((j) => j.id === job) as Job} onOpen={() => openWorkflow(wf.file, job)} />}
          </div>
        ) : null}
      </div>
    </div>
  );
});

function Graph({ wf, selected, onSelect, verdicts }: { wf: Workflow; selected: string | null; onSelect: (id: string) => void; verdicts?: { job: Job; verdict: Verdict; reason: string }[] }) {
  const cols = useMemo(() => levels(wf.jobs), [wf]);
  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    cols.forEach((col, c) => col.forEach((id, r) => m.set(id, { x: c * (CARD_W + GAP_X), y: r * (CARD_H + GAP_Y) })));
    return m;
  }, [cols]);
  const width = cols.length * (CARD_W + GAP_X);
  const height = Math.max(...cols.map((c) => c.length), 1) * (CARD_H + GAP_Y);
  return (
    <div className="relative mt-2 overflow-auto" style={{ height: height + 8 }} data-actions-graph>
      <svg className="pointer-events-none absolute left-0 top-0" width={width} height={height} aria-hidden>
        {wf.jobs.flatMap((j) =>
          j.needs
            .filter((n) => pos.has(n))
            .map((n) => {
              const a = pos.get(n) as { x: number; y: number };
              const b = pos.get(j.id) as { x: number; y: number };
              const x1 = a.x + CARD_W;
              const y1 = a.y + CARD_H / 2;
              const x2 = b.x;
              const y2 = b.y + CARD_H / 2;
              return <path key={`${n}-${j.id}`} d={`M${x1},${y1} C${x1 + GAP_X / 2},${y1} ${x2 - GAP_X / 2},${y2} ${x2},${y2}`} fill="none" stroke="currentColor" className="text-border" strokeWidth={1.5} />;
            }),
        )}
      </svg>
      {wf.jobs.map((j) => {
        const p = pos.get(j.id);
        if (!p) return null;
        const v = verdicts?.find((x) => x.job === j);
        return (
          <button
            key={j.id}
            type="button"
            data-actions-job={j.id}
            className={cn("absolute overflow-hidden rounded border bg-background px-2 py-1 text-left shadow-sm hover:border-primary/60", selected === j.id ? "border-primary" : "border-border/70")}
            style={{ left: p.x, top: p.y, width: CARD_W, height: CARD_H }}
            onClick={() => onSelect(j.id)}
            title={v && v.verdict !== "runs" ? v.reason : undefined}
          >
            <div className="truncate font-medium">{j.name}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {j.uses ? `calls ${j.uses}` : j.runsOn}
              {j.matrix === null ? " · dynamic matrix" : j.matrix.length ? ` · ×${j.matrix.length}` : ""}
            </div>
            <div className="truncate text-[10.5px]">
              {j.environment && <span className="mr-1 rounded bg-violet-500/15 px-1 text-violet-600">{j.environment}</span>}
              {j.if && <span className="text-amber-700 dark:text-amber-400">if</span>}
              {v && <span className={cn("ml-1", VERDICT_STYLE[v.verdict])}>{v.verdict}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function JobDetail({ job, onOpen }: { job: Job; onOpen: () => void }) {
  const keys = job.matrix ? [...new Set(job.matrix.flatMap((c) => Object.keys(c)))] : [];
  return (
    <div className="mt-4 space-y-2 border-t border-border/60 pt-3" data-actions-detail>
      <div className="flex items-baseline gap-2">
        <span className="font-medium">{job.name}</span>
        <button type="button" className="text-[11.5px] text-primary hover:underline" onClick={onOpen}>
          open in workflow
        </button>
      </div>
      <div className="text-muted-foreground">
        {job.uses ? `Calls ${job.uses}` : `Runs on ${job.runsOn}`}
        {job.needs.length > 0 && ` · needs ${job.needs.join(", ")}`}
        {job.timeout !== null && ` · times out after ${job.timeout} min`}
        {job.if && ` · if: ${job.if}`}
      </div>
      {job.matrix === null && <div className="text-amber-700">The matrix is computed at run time (an expression), so its combinations are unknown here.</div>}
      {job.matrix && job.matrix.length > 0 && (
        <table className="text-[11.5px]" data-actions-matrix>
          <thead>
            <tr className="text-left text-muted-foreground">
              {keys.map((k) => (
                <th key={k} className="pr-3 font-normal">
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {job.matrix.map((c, i) => (
              <tr key={i}>
                {keys.map((k) => (
                  <td key={k} className="pr-3 font-mono">
                    {c[k] === undefined ? "" : typeof c[k] === "string" ? (c[k] as string) : JSON.stringify(c[k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {job.steps.length > 0 && (
        <ol className="list-decimal space-y-0.5 pl-5">
          {job.steps.map((s, i) => (
            <li key={i}>
              <span className={s.uses ? "font-mono text-[11.5px]" : ""}>{s.name}</span>
              {s.if && <span className="ml-1 text-[11px] text-amber-700">if: {s.if}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Simulator({ ev, setEv, filesText, setFilesText, results, onOpen }: { ev: SimEvent; setEv: (f: (e: SimEvent) => SimEvent) => void; filesText: string; setFilesText: (s: string) => void; results: ReturnType<typeof simulate>; onOpen: (file: string) => void }) {
  const isPr = ev.name === "pull_request" || ev.name === "pull_request_target";
  const running = results.filter((r) => r.runs);
  return (
    <div className="space-y-3 p-3" data-actions-sim>
      <div className="flex flex-wrap items-center gap-2">
        <select className={field} value={ev.name} onChange={(e) => setEv((x) => ({ ...x, name: e.target.value }))} data-actions-event>
          {EVENTS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1">
          {isPr ? "into" : "branch"}
          <input className={cn(field, "w-40 font-mono")} value={ev.branch} onChange={(e) => setEv((x) => ({ ...x, branch: e.target.value.trim() }))} data-actions-branch />
        </label>
        {ev.name === "push" && (
          <label className="flex items-center gap-1">
            or tag
            <input className={cn(field, "w-28 font-mono")} value={ev.tag ?? ""} placeholder="v1.2.3" onChange={(e) => setEv((x) => ({ ...x, tag: e.target.value.trim() || null }))} data-actions-tag />
          </label>
        )}
        {isPr && (
          <select className={field} value={ev.type} onChange={(e) => setEv((x) => ({ ...x, type: e.target.value }))}>
            {["opened", "synchronize", "reopened", "closed", "labeled", "ready_for_review", "edited"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        )}
      </div>
      <div>
        <div className="mb-0.5 text-[11.5px] text-muted-foreground">Changed files (one per line; filled from this branch)</div>
        <textarea
          className={cn(field, "h-20 w-full max-w-2xl font-mono text-[11.5px]")}
          value={filesText}
          data-actions-files
          onChange={(e) => {
            setFilesText(e.target.value);
            const files = e.target.value.split(/\r?\n/).map((f) => f.trim()).filter(Boolean);
            setEv((x) => ({ ...x, changedFiles: files }));
          }}
        />
      </div>
      <div className="font-medium" data-actions-sim-summary>
        {running.length} of {results.length} workflow{results.length === 1 ? "" : "s"} would run
      </div>
      {results.map((r) => (
        <div key={r.workflow.file} className="rounded border border-border/50 p-2" data-actions-result={r.workflow.file}>
          <button type="button" className="flex items-baseline gap-2 text-left hover:underline" onClick={() => onOpen(r.workflow.file)}>
            <span className={r.runs ? "text-emerald-600" : "text-muted-foreground"}>{r.runs ? "runs" : "does not run"}</span>
            <span className="font-medium">{r.workflow.name}</span>
          </button>
          {!r.runs && <div className="text-[11.5px] text-muted-foreground">{r.reason}</div>}
          {r.runs && (
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
              {r.jobs.map((j) => (
                <span key={j.job.id} className={cn("text-[12px]", VERDICT_STYLE[j.verdict])} title={j.reason || undefined} data-actions-verdict={`${j.job.id}:${j.verdict}`}>
                  {j.job.name}
                  {j.job.matrix && j.job.matrix.length > 1 && j.verdict !== "skipped" ? ` ×${j.job.matrix.length}` : ""}
                  {j.verdict === "maybe" && " (maybe)"}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export const ACTIONS_GRAPH_ACTIONS = [
  { id: "actions.graph", label: "GitHub Actions: Workflow graphs and what runs on a push or pull request", keywords: ["github actions", "workflow", "ci", "jobs", "needs", "matrix", "trigger", "paths filter", "simulate", "pipeline"], run: openActionsGraph },
];
