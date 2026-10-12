// gear-imports://: the workspace's import graph — what a file imports, what
// imports it, import cycles, files nothing imports and the packages in use.

import { invoke } from "@tauri-apps/api/core";
import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { toolPaneHandle } from "@/modules/tools/paneHandle";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { buildGraph, findCycles, findOrphans, importPath, isSourceFile, mostImported, packageUse, reachable, toDot, type Graph } from "./model";

export const IMPORTS_PATH = "gear-imports://Import graph";
const MAX_FILES = 4000;

interface State {
  root: string;
  graph: Graph | null;
  busy: string | null;
  error: string | null;
  truncated: boolean;
  selected: string | null;
}

export const useImportGraph = create<State>(() => ({ root: "", graph: null, busy: null, error: null, truncated: false, selected: null }));

const join = (root: string, rel: string) => `${root.replace(/[\\/]+$/, "")}/${rel}`;

export async function scanImports(): Promise<void> {
  const root = app().workspaceRoot();
  if (!root) return void useImportGraph.setState({ error: "Open a folder first." });
  useImportGraph.setState({ root, busy: "Listing files…", error: null });
  try {
    const listed = await invoke<{ files: string[]; truncated: boolean }>("fs_list_files", { root, limit: 10000, maxDepth: 16, workspace: currentWorkspaceEnv() });
    const files = listed.files.map((f) => f.replace(/\\/g, "/")).filter(isSourceFile);
    const take = files.slice(0, MAX_FILES);
    const sources: { path: string; source: string }[] = [];
    for (let i = 0; i < take.length; i += 24) {
      useImportGraph.setState({ busy: `Reading ${Math.min(i + 24, take.length)} of ${take.length} files…` });
      const batch = await Promise.all(take.slice(i, i + 24).map((f) => native.readFile(join(root, f)).then((r) => ({ path: f, source: r.kind === "text" ? r.content : "" }), () => ({ path: f, source: "" }))));
      sources.push(...batch);
    }
    const graph = buildGraph(sources);
    const active = getActiveEditor()?.path?.replace(/\\/g, "/");
    const rootNorm = root.replace(/\\/g, "/").replace(/\/+$/, "");
    const rel = active?.startsWith(`${rootNorm}/`) ? active.slice(rootNorm.length + 1) : null;
    useImportGraph.setState({ graph, busy: null, truncated: listed.truncated || files.length > MAX_FILES, selected: rel && graph.out.has(rel) ? rel : (mostImported(graph, 1)[0]?.[0] ?? graph.files[0] ?? null) });
  } catch (err) {
    useImportGraph.setState({ busy: null, error: String(err) });
  }
}

export function openImportGraph(): void {
  app().openFile(IMPORTS_PATH);
  if (!useImportGraph.getState().graph && !useImportGraph.getState().busy) void scanImports();
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
type Tab = "file" | "cycles" | "orphans" | "top" | "packages";

function FileLink({ file, onPick, suffix }: { file: string; onPick: (f: string) => void; suffix?: string }) {
  return (
    <button type="button" data-file={file} className="flex w-full items-center gap-2 px-2 py-0.5 text-left hover:bg-muted/40" onClick={() => onPick(file)}>
      <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{file}</span>
      {suffix && <span className="shrink-0 tabular-nums text-muted-foreground">{suffix}</span>}
    </button>
  );
}

/** The selected file in the middle, what it imports on the right, what imports it on the left. */
function Neighbourhood({ graph, file, onPick }: { graph: Graph; file: string; onPick: (f: string) => void }) {
  const ins = (graph.into.get(file) ?? []).slice(0, 14);
  const outs = (graph.out.get(file) ?? []).slice(0, 14);
  const rows = Math.max(ins.length, outs.length, 1);
  const H = Math.max(120, rows * 22 + 20);
  const y = (i: number, n: number) => (n === 1 ? H / 2 : 16 + (i * (H - 32)) / (n - 1));
  const short = (f: string) => (f.length > 30 ? `…${f.slice(-29)}` : f);
  return (
    <svg viewBox={`0 0 760 ${H}`} className="w-full" style={{ maxHeight: 340 }} data-neighbourhood>
      {ins.map((f, i) => (
        <g key={`i${f}`}>
          <path d={`M 232 ${y(i, ins.length)} C 290 ${y(i, ins.length)}, 290 ${H / 2}, 318 ${H / 2}`} fill="none" stroke="currentColor" strokeOpacity={0.25} />
          <text x={228} y={y(i, ins.length) + 4} textAnchor="end" className="cursor-pointer fill-current font-mono text-[11px] hover:underline" onClick={() => onPick(f)}>
            {short(f)}
          </text>
        </g>
      ))}
      {outs.map((f, i) => (
        <g key={`o${f}`}>
          <path d={`M 442 ${H / 2} C 470 ${H / 2}, 470 ${y(i, outs.length)}, 528 ${y(i, outs.length)}`} fill="none" stroke="currentColor" strokeOpacity={0.25} />
          <text x={532} y={y(i, outs.length) + 4} className="cursor-pointer fill-current font-mono text-[11px] hover:underline" onClick={() => onPick(f)}>
            {short(f)}
          </text>
        </g>
      ))}
      <rect x={318} y={H / 2 - 13} width={124} height={26} rx={5} className="fill-primary/15 stroke-primary" />
      <text x={380} y={H / 2 + 4} textAnchor="middle" className="fill-current font-mono text-[11px] font-semibold">
        {short(file.split("/").pop() ?? file).slice(0, 18)}
      </text>
    </svg>
  );
}

export const ImportGraphPane = forwardRef<EditorPaneHandle, { path: string }>(function ImportGraphPane({ path }, ref) {
  const { root, graph, busy, error, truncated, selected } = useImportGraph();
  const [tab, setTab] = useState<Tab>("file");
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState("");

  useImperativeHandle(ref, () => toolPaneHandle(path, { setQuery, clearQuery: () => setQuery(""), reload: () => (void scanImports(), true) }), [path]);

  const cycles = useMemo(() => (graph ? findCycles(graph) : []), [graph]);
  const orphans = useMemo(() => (graph ? findOrphans(graph) : []), [graph]);
  const top = useMemo(() => (graph ? mostImported(graph, 60) : []), [graph]);
  const packages = useMemo(() => (graph ? packageUse(graph) : []), [graph]);
  const edges = useMemo(() => (graph ? [...graph.out.values()].reduce((a, l) => a + l.length, 0) : 0), [graph]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (graph?.files ?? []).filter((f) => !q || f.toLowerCase().includes(q)).slice(0, 400);
  }, [graph, query]);
  const pick = (f: string) => (useImportGraph.setState({ selected: f }), setTab("file"));
  const open = (f: string) => app().openFile(join(root, f));

  const dependsOn = useMemo(() => (graph && selected ? reachable(selected, graph.out) : []), [graph, selected]);
  const dependents = useMemo(() => (graph && selected ? reachable(selected, graph.into) : []), [graph, selected]);
  const chain = useMemo(() => {
    if (!graph || !selected || !target.trim()) return null;
    const to = graph.files.find((f) => f === target.trim()) ?? graph.files.find((f) => f.toLowerCase().includes(target.trim().toLowerCase()));
    return to ? { to, path: importPath(graph, selected, to) } : { to: null, path: null };
  }, [graph, selected, target]);

  if (busy) return <div className="p-6 text-[12.5px] text-muted-foreground">{busy}</div>;
  if (error) return <div className="p-6 text-[12.5px] text-red-500">{error}</div>;
  if (!graph)
    return (
      <div className="p-6 text-[12.5px] text-muted-foreground">
        <button type="button" className={btn} onClick={() => void scanImports()}>
          Read the imports of this workspace
        </button>
      </div>
    );

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 p-2">
        <span className="text-muted-foreground" data-graph-summary>
          {graph.files.length.toLocaleString()} files · {edges.toLocaleString()} imports
        </span>
        <span className="mx-1 h-4 w-px bg-border" />
        {(
          [
            ["file", "File"],
            ["cycles", `Cycles ${cycles.length}`],
            ["orphans", `Not imported ${orphans.length}`],
            ["top", "Most imported"],
            ["packages", `Packages ${packages.length}`],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" data-tab={id} className={cn(btn, tab === id && "bg-muted font-medium")} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
        <span className="flex-1" />
        <button type="button" className={btn} title="Graphviz DOT of the whole graph" onClick={() => void navigator.clipboard.writeText(toDot(graph)).then(() => toast.success("DOT copied"))}>
          Copy as DOT
        </button>
        <button type="button" className={btn} onClick={() => void scanImports()}>
          Rescan
        </button>
      </div>
      {truncated && <div className="border-b border-border/60 bg-amber-500/10 px-3 py-1 text-amber-600">This workspace is large — only the first {MAX_FILES.toLocaleString()} source files were read.</div>}
      {graph.files.length === 0 ? (
        <div className="p-6 text-muted-foreground">No JavaScript, TypeScript or Python files found in this folder.</div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[300px] shrink-0 flex-col border-r border-border/60">
            <input className="m-2 rounded border border-border/60 bg-background px-2 py-1 text-[12px] outline-none focus:border-ring" value={query} placeholder="Find a file" onChange={(e) => setQuery(e.target.value)} />
            <div className="min-h-0 flex-1 overflow-auto">
              {matches.map((f) => (
                <button key={f} type="button" className={cn("flex w-full items-center gap-2 px-2 py-0.5 text-left hover:bg-muted/40", f === selected && "bg-muted/60")} onClick={() => pick(f)}>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={f}>
                    {f}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground" title="imported by / imports">
                    {graph.into.get(f)?.length ?? 0}←→{graph.out.get(f)?.length ?? 0}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="min-w-0 flex-1 overflow-auto">
            {tab === "file" && selected && (
              <div className="space-y-2 p-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono font-medium" data-selected>
                    {selected}
                  </span>
                  <button type="button" className={btn} onClick={() => open(selected)}>
                    Open
                  </button>
                </div>
                <Neighbourhood graph={graph} file={selected} onPick={pick} />
                <div className="text-muted-foreground" data-reach>
                  Depends on {dependsOn.length} files in total; {dependents.length} files depend on it (a change here can affect them).
                </div>
                <div className="flex flex-wrap gap-3">
                  <div className="min-w-[240px] flex-1 rounded-md border border-border/60">
                    <div className="border-b border-border/60 px-2 py-1 font-medium">Imported by ({graph.into.get(selected)?.length ?? 0})</div>
                    {(graph.into.get(selected) ?? []).map((f) => (
                      <FileLink key={f} file={f} onPick={pick} />
                    ))}
                  </div>
                  <div className="min-w-[240px] flex-1 rounded-md border border-border/60">
                    <div className="border-b border-border/60 px-2 py-1 font-medium">Imports ({graph.out.get(selected)?.length ?? 0})</div>
                    {(graph.out.get(selected) ?? []).map((f) => (
                      <FileLink key={f} file={f} onPick={pick} />
                    ))}
                    {(graph.packages.get(selected) ?? []).map((p) => (
                      <div key={p} className="px-2 py-0.5 font-mono text-[12px] text-muted-foreground">
                        {p} <span className="font-sans">(package)</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-md border border-border/60 p-2">
                  <div className="mb-1 font-medium">How does this file reach…</div>
                  <input className="w-full rounded border border-border/60 bg-background px-2 py-1 font-mono text-[12px] outline-none focus:border-ring" data-chain-input value={target} placeholder="another file (part of its path)" onChange={(e) => setTarget(e.target.value)} />
                  {chain && (
                    <div className="mt-1 font-mono text-[12px]" data-chain>
                      {chain.to === null ? <span className="font-sans text-muted-foreground">No file matches.</span> : chain.path ? chain.path.join("  →  ") : <span className="font-sans text-muted-foreground">It does not import {chain.to}, directly or indirectly.</span>}
                    </div>
                  )}
                </div>
              </div>
            )}
            {tab === "cycles" &&
              (cycles.length === 0 ? (
                <div className="p-4 text-muted-foreground">No import cycles.</div>
              ) : (
                <div className="space-y-2 p-2">
                  {cycles.map((c, i) => (
                    <div key={i} className="rounded-md border border-border/60" data-cycle>
                      <div className="border-b border-border/60 px-2 py-1 font-medium">{c.length} files import each other</div>
                      {c.map((f) => (
                        <FileLink key={f} file={f} onPick={pick} />
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            {tab === "orphans" &&
              (orphans.length === 0 ? (
                <div className="p-4 text-muted-foreground">Every file is imported somewhere (entry points, tests and config files are not counted).</div>
              ) : (
                <div className="p-2">
                  <div className="mb-1 text-muted-foreground">Nothing in the workspace imports these. Entry points, tests and config files are left out; a file loaded by name (a script, a route) can still be in use.</div>
                  {orphans.map((f) => (
                    <FileLink key={f} file={f} onPick={pick} />
                  ))}
                </div>
              ))}
            {tab === "top" && top.map(([f, n]) => <FileLink key={f} file={f} onPick={pick} suffix={`${n} importers`} />)}
            {tab === "packages" &&
              (packages.length === 0 ? (
                <div className="p-4 text-muted-foreground">No package imports found.</div>
              ) : (
                packages.map(([p, n]) => (
                  <div key={p} className="flex items-center gap-2 px-2 py-0.5" data-package={p}>
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{p}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {n} {n === 1 ? "file" : "files"}
                    </span>
                  </div>
                ))
              ))}
          </div>
        </div>
      )}
    </div>
  );
});
