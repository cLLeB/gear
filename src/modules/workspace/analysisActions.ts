// Palette actions for workspace-wide code analysis and the scope-aware
// refactorings in analysis.ts.

import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { analyzeComplexity } from "@/lib/lang/complexity";
import { buildCallGraph, recursiveGroups } from "@/lib/lang/callGraph";
import { findClones } from "@/lib/lang/cloneDetection";
import { structuralReplace, structuralSearch } from "@/lib/lang/structuralSearch";
import { analyzeTaint, DEFAULT_TAINT_CONFIG } from "@/lib/lang/taint";
import { native } from "@/modules/ai/lib/native";
import { openTextViewer } from "@/modules/compare/CompareDialog";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { inputBox, quickPick } from "@/modules/quick-pick";
import {
  buildImportGraph,
  concatSources,
  cyclePath,
  extractFunction,
  importCycles,
  importersOf,
  inlineVariable,
  langIdForPath,
  parseChurn,
  rankHotspots,
  renderCallGraph,
  transitiveImports,
  unusedExports,
} from "./analysis";

const IGNORED = /(^|\/)(node_modules|dist|build|target|out|\.next|coverage|vendor|__pycache__|\.venv|venv)\//;
const MAX_FILES = 2500;
const MAX_BYTES = 400_000;

function requireRoot(): string | null {
  const r = app().workspaceRoot();
  if (!r) toast.error("Open a folder first");
  return r?.replace(/[\\/]+$/, "").replace(/\\/g, "/") ?? null;
}

function rel(root: string, p: string): string {
  return p.replace(/\\/g, "/").startsWith(`${root}/`) ? p.replace(/\\/g, "/").slice(root.length + 1) : p;
}

/** Read the workspace's analysable source files (bounded). */
async function loadSources(root: string, pattern: string): Promise<{ path: string; rel: string; source: string }[]> {
  const g = await native.glob({ pattern, root, maxResults: MAX_FILES * 2 }).catch(() => null);
  const hits = (g?.hits ?? []).filter((h) => !IGNORED.test(h.rel.replace(/\\/g, "/")) && !/\.min\.js$|\.d\.ts$/.test(h.rel)).slice(0, MAX_FILES);
  const out: { path: string; rel: string; source: string }[] = [];
  for (let i = 0; i < hits.length; i += 24) {
    const batch = await Promise.all(hits.slice(i, i + 24).map((h) => native.readFile(h.path).catch(() => null)));
    batch.forEach((r, j) => {
      if (r?.kind === "text" && r.content.length <= MAX_BYTES) out.push({ path: hits[i + j].path.replace(/\\/g, "/"), rel: hits[i + j].rel.replace(/\\/g, "/"), source: r.content });
    });
  }
  return out;
}

const JS_GLOB = "**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}";
const CODE_GLOB = "**/*.{ts,tsx,js,jsx,mjs,cjs,py,rs,go,c,h,cc,cpp,hpp,cs,java}";

async function withProgress<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  const t = toast.loading(label);
  try {
    return await fn();
  } catch (e) {
    toast.error(String(e instanceof Error ? e.message : e));
    return null;
  } finally {
    toast.dismiss(t);
  }
}

function lineOf(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

function activeFile(): { path: string; view: NonNullable<ReturnType<typeof getActiveEditor>>["view"]; lang: string } | null {
  const ed = getActiveEditor();
  if (!ed?.path) {
    toast.info("Open a file in the editor first");
    return null;
  }
  const lang = langIdForPath(ed.path) ?? (ed.languageId || null);
  if (!lang) {
    toast.info("This file type isn't supported by the analyser");
    return null;
  }
  return { path: ed.path.replace(/\\/g, "/"), view: ed.view, lang };
}

// ── workspace ─────────────────────────────────────────────────────────────

export async function complexFunctions(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const rows = await withProgress("Measuring complexity…", async () => {
    const files = await loadSources(root, CODE_GLOB);
    const out: { name: string; complexity: number; path: string; rel: string; line: number }[] = [];
    for (const f of files) {
      const lang = langIdForPath(f.path);
      if (!lang) continue;
      for (const fn of analyzeComplexity(f.source, lang).functions) out.push({ name: fn.name, complexity: fn.complexity, path: f.path, rel: f.rel, line: lineOf(f.source, fn.from) });
    }
    return { out: out.sort((a, b) => b.complexity - a.complexity).slice(0, 200), files: files.length };
  });
  if (!rows) return;
  const pick = await quickPick(
    rows.out.map((r) => ({ label: `${r.complexity >= 20 ? "🔴" : r.complexity >= 10 ? "🟠" : "🟢"} ${r.name}`, description: `cyclomatic ${r.complexity} · ${r.rel}:${r.line}`, value: r })),
    { title: `Most complex functions (${rows.files} files)`, emptyText: "No functions found" },
  );
  if (pick) app().openFile(pick.path, pick.line);
}

export async function churnHotspots(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const since = await quickPick(
    [
      { label: "Last 3 months", value: "3 months ago" },
      { label: "Last year", value: "1 year ago" },
      { label: "All history", value: "" },
    ],
    { title: "Churn window" },
  );
  if (since === undefined) return;
  const ranked = await withProgress("Reading git history and measuring complexity…", async () => {
    const log = await native.runCommand(`git log --relative --no-merges --format= --name-only${since ? ` --since="${since}"` : ""}`, root, 60);
    if (log.exit_code !== 0) throw new Error(log.stderr.trim() || "git log failed");
    const churn = parseChurn(log.stdout);
    const files = await loadSources(root, CODE_GLOB);
    const rows = files.map((f) => {
      const lang = langIdForPath(f.path)!;
      return { path: f.rel, complexity: analyzeComplexity(f.source, lang).fileComplexity, churn: churn.get(f.rel) ?? 0 };
    });
    return rankHotspots(rows).slice(0, 100);
  });
  if (!ranked) return;
  const pick = await quickPick(
    ranked.map((r) => ({ label: r.path, description: `score ${r.score} · complexity ${r.complexity} · ${r.churn} commits`, value: r })),
    { title: "Hotspots — complex files that change often (refactor these first)", emptyText: "No hotspots (no history or no code)" },
  );
  if (pick) app().openFile(`${root}/${pick.path}`);
}

export async function unusedExportsCmd(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const res = await withProgress("Scanning exports…", async () => {
    const files = await loadSources(root, JS_GLOB);
    return { unused: unusedExports(files), n: files.length };
  });
  if (!res) return;
  const pick = await quickPick(
    res.unused.map((u) => ({ label: u.name, description: `${rel(root, u.path)}:${u.line}`, value: u })),
    { title: `${res.unused.length} export(s) never referenced elsewhere (${res.n} files)`, emptyText: "Every export is used somewhere" },
  );
  if (pick) app().openFile(pick.path, pick.line);
}

export async function importCyclesCmd(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const res = await withProgress("Building import graph…", async () => {
    const files = await loadSources(root, JS_GLOB);
    const g = buildImportGraph(files, root);
    return importCycles(g).map((c) => ({ comp: c, path: cyclePath(g, c) }));
  });
  if (!res) return;
  if (!res.length) return void toast.success("No circular imports");
  const pick = await quickPick(
    res.map((c) => ({ label: c.path.map((p) => rel(root, p).replace(/^.*\//, "")).join(" → "), description: `${c.comp.length} files`, value: c })),
    { title: `${res.length} import cycle(s)` },
  );
  if (!pick) return;
  const file = await quickPick(pick.comp.map((p) => ({ label: rel(root, p), value: p })), { title: "Open a file in the cycle" });
  if (file) app().openFile(file);
}

export async function importersOfFile(): Promise<void> {
  const root = requireRoot();
  const ed = getActiveEditor();
  if (!root) return;
  if (!ed?.path) return void toast.info("Open a file first");
  const target = ed.path.replace(/\\/g, "/");
  const res = await withProgress("Building import graph…", async () => {
    const g = buildImportGraph(await loadSources(root, JS_GLOB), root);
    const direct = importersOf(g, target);
    // Transitive dependents: walk the reversed graph.
    const all = new Set<string>();
    const stack = [...direct];
    while (stack.length) {
      const f = stack.pop()!;
      if (all.has(f) || f === target) continue;
      all.add(f);
      stack.push(...importersOf(g, f));
    }
    return { direct, indirect: [...all].filter((f) => !direct.includes(f)).sort() };
  });
  if (!res) return;
  const pick = await quickPick(
    [...res.direct.map((p) => ({ label: rel(root, p), description: "imports this file", value: p })), ...res.indirect.map((p) => ({ label: rel(root, p), description: "indirectly", value: p }))],
    { title: `${res.direct.length} direct · ${res.indirect.length} indirect dependents (blast radius)`, emptyText: "Nothing imports this file" },
  );
  if (pick) app().openFile(pick);
}

export async function dependenciesOfFile(): Promise<void> {
  const root = requireRoot();
  const ed = getActiveEditor();
  if (!root) return;
  if (!ed?.path) return void toast.info("Open a file first");
  const target = ed.path.replace(/\\/g, "/");
  const res = await withProgress("Building import graph…", async () => {
    const g = buildImportGraph(await loadSources(root, JS_GLOB), root);
    const direct = [...(g.get(target) ?? [])];
    return { direct, all: transitiveImports(g, target) };
  });
  if (!res) return;
  const pick = await quickPick(
    res.all.map((p) => ({ label: rel(root, p), description: res.direct.includes(p) ? "direct" : "transitive", value: p })),
    { title: `${res.direct.length} direct · ${res.all.length} total local dependencies`, emptyText: "No local imports" },
  );
  if (pick) app().openFile(pick);
}

export async function workspaceStructuralSearch(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const pattern = await inputBox({ title: "Structural search ($name matches any expression)", placeholder: "e.g. console.log($x)   or   if ($a == null) $b", value: "" });
  if (!pattern) return;
  // Cheap prefilter: the longest literal word in the pattern must appear in the file.
  const anchor = (pattern.replace(/\$\w+/g, " ").match(/[A-Za-z_]\w*/g) ?? []).sort((a, b) => b.length - a.length)[0] ?? "";
  const hits = await withProgress("Searching code structurally…", async () => {
    const out: { path: string; rel: string; line: number; text: string; binds: string }[] = [];
    for (const f of await loadSources(root, CODE_GLOB)) {
      const lang = langIdForPath(f.path)!;
      if (anchor && !f.source.includes(anchor)) continue;
      for (const m of structuralSearch(f.source, lang, pattern)) {
        out.push({
          path: f.path,
          rel: f.rel,
          line: lineOf(f.source, m.from),
          text: f.source.slice(m.from, m.to).replace(/\s+/g, " ").slice(0, 120),
          binds: [...m.bindings].map(([k, v]) => `${k}=${v.text.replace(/\s+/g, " ").slice(0, 30)}`).join(" ").slice(0, 80),
        });
        if (out.length >= 500) return out;
      }
    }
    return out;
  });
  if (!hits) return;
  const pick = await quickPick(hits.map((h) => ({ label: h.text, description: `${h.rel}:${h.line}${h.binds ? ` · ${h.binds}` : ""}`, value: h })), { title: `${hits.length} structural match(es)`, emptyText: "No matches" });
  if (pick) app().openFile(pick.path, pick.line);
}

export async function workspaceClones(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const min = await quickPick(
    [
      { label: "Medium blocks (40+ tokens)", value: 40 },
      { label: "Large blocks only (80+ tokens)", value: 80 },
      { label: "Small blocks too (25+ tokens)", value: 25 },
    ],
    { title: "Duplicate size" },
  );
  if (!min) return;
  const res = await withProgress("Looking for copy-pasted code across files…", async () => {
    const files = (await loadSources(root, JS_GLOB)).slice(0, 800);
    const c = concatSources(files);
    return findClones(c.source, "javascript", { minTokens: min })
      .map((p) => ({ a: c.locate(p.a.from), b: c.locate(p.b.from), tokens: p.tokenLength, snippet: c.source.slice(p.a.from, p.a.to).split("\n")[0].trim().slice(0, 80) }))
      .slice(0, 300);
  });
  if (!res) return;
  const pick = await quickPick(
    res.map((p) => ({ label: p.snippet || "(block)", description: `${rel(root, p.a.path)}:${p.a.line} ≈ ${rel(root, p.b.path)}:${p.b.line} · ${p.tokens} tokens`, value: p })),
    { title: `${res.length} duplicated block(s)`, emptyText: "No duplicates found" },
  );
  if (!pick) return;
  const side = await quickPick(
    [
      { label: `${rel(root, pick.a.path)}:${pick.a.line}`, value: pick.a },
      { label: `${rel(root, pick.b.path)}:${pick.b.line}`, value: pick.b },
    ],
    { title: "Open which copy?" },
  );
  if (side) app().openFile(side.path, side.line);
}

// ── current file ──────────────────────────────────────────────────────────

export function callGraphOfFile(): void {
  const f = activeFile();
  if (!f) return;
  const g = buildCallGraph(f.view.state.doc.toString(), f.lang);
  if (!g.functions.length) return void toast.info("No functions found");
  const rec = recursiveGroups(g);
  const extra = rec.length ? `\n## Recursion\n\n${rec.map((r) => `- ${r.join(" ↔ ")}`).join("\n")}\n` : "";
  openTextViewer(`Call graph — ${f.path.replace(/^.*\//, "")}`, renderCallGraph(g) + extra, "markdown");
}

export function taintCheck(): void {
  const f = activeFile();
  if (!f) return;
  const src = f.view.state.doc.toString();
  const flows = analyzeTaint(src, f.lang, DEFAULT_TAINT_CONFIG);
  if (!flows.length) return void toast.success("No untrusted input reaches a dangerous sink (eval, exec, query, innerHTML…)");
  void quickPick(
    flows.map((fl) => ({ label: `⚠ ${fl.sink}(${fl.variable ?? "…"})`, description: `line ${lineOf(src, fl.from)} · ${fl.variable ? `${fl.variable} carries user input` : "direct source → sink"}`, value: fl })),
    { title: `${flows.length} tainted flow(s)` },
  ).then((pick) => {
    if (pick) f.view.dispatch({ selection: { anchor: pick.from, head: pick.to }, scrollIntoView: true });
  });
}

export async function structuralReplaceInFile(): Promise<void> {
  const f = activeFile();
  if (!f) return;
  const pattern = await inputBox({ title: "Find pattern ($name = any expression)", placeholder: "e.g. $a.indexOf($b) !== -1" });
  if (!pattern) return;
  const src = f.view.state.doc.toString();
  const n = structuralSearch(src, f.lang, pattern).length;
  if (!n) return void toast.info("No matches");
  const template = await inputBox({ title: `Replace ${n} match(es) with`, placeholder: "e.g. $a.includes($b)" });
  if (template === undefined) return;
  const out = structuralReplace(src, f.lang, pattern, template);
  f.view.dispatch({ changes: { from: 0, to: src.length, insert: out } });
  toast.success(`Rewrote ${n} match(es)`);
}

export async function extractFunctionCmd(): Promise<void> {
  const f = activeFile();
  if (!f) return;
  const sel = f.view.state.selection.main;
  if (sel.empty) return void toast.info("Select the statements or expression to extract");
  const name = await inputBox({ title: "New function name", value: "extracted" });
  if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) return;
  try {
    const edits = extractFunction(f.view.state.doc.toString(), f.lang, sel.from, sel.to, name);
    f.view.dispatch({ changes: edits, scrollIntoView: true });
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  }
}

export function inlineVariableCmd(): void {
  const f = activeFile();
  if (!f) return;
  try {
    const edits = inlineVariable(f.view.state.doc.toString(), f.lang, f.view.state.selection.main.head);
    f.view.dispatch({ changes: edits });
    toast.success(`Inlined into ${edits.length - 1} use(s)`);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  }
}

export const ANALYSIS_ACTIONS = [
  { id: "analysis.complexFunctions", label: "Workspace: Most complex functions", keywords: ["complexity", "cyclomatic", "refactor", "hotspot", "functions", "metrics"], run: complexFunctions },
  { id: "analysis.hotspots", label: "Workspace: Hotspots (git churn × complexity)", keywords: ["hotspot", "churn", "complexity", "technical debt", "refactor", "code health"], run: churnHotspots },
  { id: "analysis.unusedExports", label: "Workspace: Unused exports", keywords: ["unused", "exports", "dead code", "ts-prune", "knip", "cleanup"], run: unusedExportsCmd },
  { id: "analysis.importCycles", label: "Workspace: Circular imports", keywords: ["circular", "cycle", "dependency", "madge", "imports", "loop"], run: importCyclesCmd },
  { id: "analysis.importers", label: "Who imports this file? (blast radius)", keywords: ["importers", "dependents", "reverse dependencies", "used by", "impact"], run: importersOfFile },
  { id: "analysis.dependencies", label: "Local dependencies of this file (transitive)", keywords: ["imports", "dependencies", "dependency tree", "graph"], run: dependenciesOfFile },
  { id: "analysis.structuralSearch", label: "Workspace: Structural search ($metavariables)…", keywords: ["structural", "ast", "semgrep", "comby", "pattern", "search code"], run: workspaceStructuralSearch },
  { id: "analysis.clones", label: "Workspace: Duplicate code across files", keywords: ["duplicate", "clones", "copy paste", "jscpd", "dry"], run: workspaceClones },
  { id: "analysis.callGraph", label: "Call graph of this file", keywords: ["call graph", "callers", "callees", "mermaid", "functions", "recursion"], run: callGraphOfFile },
  { id: "analysis.taint", label: "Security: Taint check this file (input → eval/exec/SQL/innerHTML)", keywords: ["taint", "security", "injection", "xss", "sql injection", "dataflow"], run: taintCheck },
  { id: "analysis.structuralReplace", label: "Structural replace in this file ($metavariables)…", keywords: ["structural", "rewrite", "codemod", "pattern", "replace", "refactor"], run: structuralReplaceInFile },
  { id: "analysis.extractFunction", label: "Refactor: Extract function", keywords: ["extract", "function", "method", "refactor", "move"], run: extractFunctionCmd },
  { id: "analysis.inlineVariable", label: "Refactor: Inline variable", keywords: ["inline", "variable", "refactor", "remove temp"], run: inlineVariableCmd },
];
