// Pure helpers for workspace-wide code analysis: import graphs and cycles,
// unused exports, churn × complexity hotspots, workspace clone detection, and
// two refactorings built on the scope binder (extract function, inline
// variable).

import { buildScopeTree, resolveBinding, scopeAt, type Scope } from "@/lib/lang/scopes";
import { findDefinition, findReferences } from "@/lib/lang/references";
import { getLanguageSpec } from "@/lib/lang/languages";
import { tokenize, type Token } from "@/lib/lang/lexer";
import type { CallGraph } from "@/lib/lang/callGraph";
import { importCandidates, importSpecifiers } from "./projectTools2";

/** The analysis language id for a file path, or null when unsupported. */
export function langIdForPath(path: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "vue", "svelte"].includes(ext)) return "javascript";
  if (["py", "pyi"].includes(ext)) return "python";
  if (ext === "rs") return "rust";
  if (ext === "go") return "go";
  if (["c", "h", "cc", "cpp", "hpp", "cxx", "cs", "java", "kt", "swift"].includes(ext)) return "c";
  if (ext === "json") return "json";
  return null;
}

// ── import graph ──────────────────────────────────────────────────────────

export type ImportGraph = Map<string, Set<string>>;

/** File → files it imports, resolving relative and aliased specifiers against `known` paths. */
export function buildImportGraph(files: { path: string; source: string }[], root: string): ImportGraph {
  const known = new Set(files.map((f) => f.path.replace(/\\/g, "/")));
  const g: ImportGraph = new Map();
  for (const f of files) {
    const from = f.path.replace(/\\/g, "/");
    const deps = new Set<string>();
    for (const spec of importSpecifiers(f.source)) {
      const hit = importCandidates(from, spec, root).find((c) => known.has(c));
      if (hit && hit !== from) deps.add(hit);
    }
    g.set(from, deps);
  }
  return g;
}

/** Files that import `target` directly. */
export function importersOf(g: ImportGraph, target: string): string[] {
  const t = target.replace(/\\/g, "/");
  return [...g].filter(([, deps]) => deps.has(t)).map(([f]) => f).sort();
}

/** Every file reachable from `start` through imports (excluding itself). */
export function transitiveImports(g: ImportGraph, start: string): string[] {
  const seen = new Set<string>();
  const stack = [...(g.get(start) ?? [])];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f) || f === start) continue;
    seen.add(f);
    for (const d of g.get(f) ?? []) stack.push(d);
  }
  return [...seen].sort();
}

/** Import cycles: strongly connected components with more than one file (Tarjan). */
export function importCycles(g: ImportGraph): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  const nodes = new Set<string>([...g.keys(), ...[...g.values()].flatMap((s) => [...s])]);
  // Iterative Tarjan so deep graphs never blow the call stack.
  for (const start of nodes) {
    if (idx.has(start)) continue;
    const work: { v: string; it: Iterator<string> }[] = [];
    const push = (v: string) => {
      idx.set(v, index);
      low.set(v, index++);
      stack.push(v);
      onStack.add(v);
      work.push({ v, it: (g.get(v) ?? new Set<string>())[Symbol.iterator]() });
    };
    push(start);
    while (work.length) {
      const top = work[work.length - 1];
      const n = top.it.next();
      if (!n.done) {
        const w = n.value;
        if (!idx.has(w)) push(w);
        else if (onStack.has(w)) low.set(top.v, Math.min(low.get(top.v)!, idx.get(w)!));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1].v;
        low.set(parent, Math.min(low.get(parent)!, low.get(top.v)!));
      }
      if (low.get(top.v) === idx.get(top.v)) {
        const comp: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          comp.push(w);
        } while (w !== top.v);
        if (comp.length > 1) out.push(comp.sort());
      }
    }
  }
  return out.sort((a, b) => b.length - a.length);
}

/** One concrete loop through a cycle's files, for display ("a → b → c → a"). */
export function cyclePath(g: ImportGraph, comp: string[]): string[] {
  const inComp = new Set(comp);
  const start = comp[0];
  const prev = new Map<string, string>();
  const queue = [start];
  const seen = new Set([start]);
  while (queue.length) {
    const v = queue.shift()!;
    for (const w of g.get(v) ?? []) {
      if (!inComp.has(w)) continue;
      if (w === start) {
        const path = [v];
        while (path[0] !== start) path.unshift(prev.get(path[0])!);
        return [...path, start];
      }
      if (!seen.has(w)) {
        seen.add(w);
        prev.set(w, v);
        queue.push(w);
      }
    }
  }
  return [...comp, start];
}

// ── exports ───────────────────────────────────────────────────────────────

export interface ExportedName {
  name: string;
  line: number;
}

/** Names a JS/TS module exports (declarations and `export { a, b as c }`). */
export function exportedNames(source: string): ExportedName[] {
  const out: ExportedName[] = [];
  const lineOf = (i: number) => source.slice(0, i).split("\n").length;
  for (const m of source.matchAll(/^[ \t]*export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:const|let|var|function\*?|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/gm)) {
    out.push({ name: m[1], line: lineOf(m.index!) });
  }
  for (const m of source.matchAll(/^[ \t]*export\s*\{([^}]*)\}(?!\s*from)/gm)) {
    for (const part of m[1].split(",")) {
      const name = /(?:\bas\s+)?([A-Za-z_$][\w$]*)\s*$/.exec(part.trim())?.[1];
      if (name && name !== "default" && part.trim()) out.push({ name, line: lineOf(m.index!) });
    }
  }
  return out;
}

/** Exports whose name never appears as a word in any other file. */
export function unusedExports(files: { path: string; source: string }[], entryPattern = /(^|\/)(main|index|App|vite\.config|.*\.config|.*\.d)\.[a-z]+$|\.(test|spec|stories)\.[a-z]+$/): { path: string; name: string; line: number }[] {
  const words = new Map<string, Set<string>>();
  for (const f of files) words.set(f.path, new Set(f.source.match(/[A-Za-z_$][\w$]*/g) ?? []));
  const out: { path: string; name: string; line: number }[] = [];
  for (const f of files) {
    if (entryPattern.test(f.path)) continue;
    for (const e of exportedNames(f.source)) {
      const used = files.some((o) => o.path !== f.path && words.get(o.path)!.has(e.name));
      if (!used) {
        // Still used inside its own file beyond the declaration? Then it only needs `export` dropped.
        out.push({ path: f.path, name: e.name, line: e.line });
      }
    }
  }
  return out;
}

// ── hotspots ──────────────────────────────────────────────────────────────

/** Commit counts per path from `git log --format= --name-only`. */
export function parseChurn(log: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const line of log.split(/\r?\n/)) {
    const p = line.trim();
    if (p) m.set(p, (m.get(p) ?? 0) + 1);
  }
  return m;
}

export interface Hotspot {
  path: string;
  complexity: number;
  churn: number;
  score: number;
}

/** Rank files by normalised complexity × churn (the classic "hotspot" metric). */
export function rankHotspots(rows: { path: string; complexity: number; churn: number }[]): Hotspot[] {
  const maxC = Math.max(1, ...rows.map((r) => r.complexity));
  const maxH = Math.max(1, ...rows.map((r) => r.churn));
  return rows
    .map((r) => ({ ...r, score: Math.round((r.complexity / maxC) * (r.churn / maxH) * 1000) / 10 }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || b.complexity - a.complexity);
}

// ── workspace clones ──────────────────────────────────────────────────────

export interface Concatenated {
  source: string;
  locate: (offset: number) => { path: string; line: number };
}

/** Join files into one document (blank-line separated) and map offsets back to file + line. */
export function concatSources(files: { path: string; source: string }[]): Concatenated {
  const starts: { at: number; path: string; source: string }[] = [];
  let source = "";
  for (const f of files) {
    starts.push({ at: source.length, path: f.path, source: f.source });
    source += `${f.source}\n;\n\n`;
  }
  return {
    source,
    locate(offset) {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid].at <= offset) lo = mid;
        else hi = mid - 1;
      }
      const s = starts[lo];
      return { path: s.path, line: s.source.slice(0, offset - s.at).split("\n").length };
    },
  };
}

// ── call graph rendering ──────────────────────────────────────────────────

/** A Mermaid flowchart plus an indented outline for a file's call graph. */
export function renderCallGraph(g: CallGraph): string {
  const names = g.functions.map((f) => f.name);
  const id = (n: string) => n.replace(/[^\w]/g, "_");
  const lines = ["# Call graph", "", "```mermaid", "flowchart LR"];
  for (const n of names) {
    const callees = [...(g.edges.get(n) ?? [])];
    if (!callees.length) lines.push(`  ${id(n)}[${n}]`);
    for (const c of callees) lines.push(`  ${id(n)}[${n}] --> ${id(c)}[${c}]`);
  }
  lines.push("```", "", "## Outline", "");
  for (const n of names) {
    const callees = [...(g.edges.get(n) ?? [])];
    const callers = names.filter((o) => g.edges.get(o)?.has(n));
    lines.push(`- **${n}**${callees.length ? ` → ${callees.join(", ")}` : ""}${callers.length ? `  _(called by ${callers.join(", ")})_` : "  _(no callers in this file)_"}`);
  }
  return `${lines.join("\n")}\n`;
}

// ── extract function ──────────────────────────────────────────────────────

export interface Edit {
  from: number;
  to: number;
  insert: string;
}

function identifiers(source: string, languageId: string, from: number, to: number): Token[] {
  const spec = getLanguageSpec(languageId);
  if (!spec) return [];
  const toks = tokenize(source.slice(from, to), spec.lexer).map((t) => ({ ...t, start: t.start + from, end: t.end + from }));
  return toks.filter((t, i) => {
    if (t.type !== "identifier") return false;
    const prev = toks[i - 1];
    // Skip property access (`a.b`) and object keys (`{ b: 1 }` → next is ":" after "{" or ",").
    if (prev && prev.value === "." ) return false;
    const next = toks[i + 1];
    if (next?.value === ":" && (prev?.value === "{" || prev?.value === ",") && languageId !== "python") return false;
    return true;
  });
}

function bindingScope(root: Scope, offset: number, name: string): Scope | null {
  for (let s: Scope | null = scopeAt(root, offset); s; s = s.parent) {
    if (s.bindings.get(name)?.length) return s;
  }
  return null;
}

function dedent(text: string): string {
  const lines = text.split("\n");
  const ind = Math.min(...lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length));
  return lines.map((l) => l.slice(Number.isFinite(ind) ? ind : 0)).join("\n");
}

/**
 * Extract `source[from, to)` into a new top-level function. Free variables
 * bound in an enclosing (non-global) scope become parameters; variables
 * declared in the selection and read afterwards become return values.
 */
export function extractFunction(source: string, languageId: string, from: number, to: number, name: string): Edit[] {
  const py = languageId === "python";
  if (languageId !== "javascript" && !py) throw new Error("Extract function supports JavaScript/TypeScript and Python");
  // Trim the selection to whole content.
  while (from < to && /\s/.test(source[from])) from++;
  while (to > from && /\s/.test(source[to - 1])) to--;
  if (from >= to) throw new Error("Select the code to extract");
  const text = source.slice(from, to);
  if (/\breturn\b|\byield\b/.test(text)) throw new Error("The selection contains return/yield — extract a smaller block");
  const root = buildScopeTree(source, languageId);
  const params: string[] = [];
  const declared = new Map<string, number>();
  for (const t of identifiers(source, languageId, from, to)) {
    const b = resolveBinding(scopeAt(root, t.start), t.value);
    if (!b) continue;
    if (b.offset >= from && b.offset < to) {
      if (!declared.has(t.value)) declared.set(t.value, b.offset);
      continue;
    }
    const owner = bindingScope(root, t.start, t.value);
    if (owner && owner !== root && !params.includes(t.value)) params.push(t.value);
  }
  const returns = [...declared].filter(([, off]) => findReferences(source, languageId, off).some((o) => o.from >= to)).map(([n]) => n);
  const isExpression = !py && !/[;\n]/.test(text) && !/^(const|let|var|if|for|while|switch|try)\b/.test(text) && !/^\w+\s*=[^=]/.test(text);
  const isAsync = /\bawait\b/.test(text);
  const lineStart = source.lastIndexOf("\n", from - 1) + 1;
  const indent = /^[ \t]*/.exec(source.slice(lineStart))![0];
  // Insert above the outermost enclosing top-level declaration.
  const top = root.children.find((c) => c.from <= from && c.to >= to);
  let insertAt = top ? source.lastIndexOf("\n", top.from - 1) + 1 : lineStart;
  if (top) {
    // Walk up over a multi-line header / decorators until a blank or unindented-start line.
    while (insertAt > 0) {
      const prevStart = source.lastIndexOf("\n", insertAt - 2) + 1;
      const prevLine = source.slice(prevStart, insertAt - 1);
      if (!prevLine.trim() || /^\S/.test(source.slice(insertAt)) ) break;
      insertAt = prevStart;
    }
  }
  const body = dedent(source.slice(lineStart, to).replace(/^[ \t]*/, indent)).split("\n");
  const unit = py ? "    " : "  ";
  let fn: string;
  let call: string;
  const args = params.join(", ");
  const callExpr = `${isAsync ? "await " : ""}${name}(${args})`;
  if (py) {
    const ret = returns.length ? [`return ${returns.join(", ")}`] : [];
    fn = `${isAsync ? "async " : ""}def ${name}(${args}):\n${[...body, ...ret].map((l) => (l.trim() ? unit + l : "")).join("\n")}\n\n\n`;
    call = returns.length ? `${returns.join(", ")} = ${callExpr}` : callExpr;
  } else if (isExpression) {
    fn = `${isAsync ? "async " : ""}function ${name}(${args}) {\n${unit}return ${text};\n}\n\n`;
    call = callExpr;
  } else {
    const ret = returns.length === 1 ? [`return ${returns[0]};`] : returns.length ? [`return { ${returns.join(", ")} };`] : [];
    fn = `${isAsync ? "async " : ""}function ${name}(${args}) {\n${[...body, ...ret].map((l) => (l.trim() ? unit + l : "")).join("\n")}\n}\n\n`;
    call = returns.length === 1 ? `const ${returns[0]} = ${callExpr};` : returns.length ? `const { ${returns.join(", ")} } = ${callExpr};` : `${callExpr};`;
  }
  return [
    { from: insertAt, to: insertAt, insert: fn },
    { from, to, insert: call },
  ];
}

// ── inline variable ───────────────────────────────────────────────────────

/** Inline a single-assignment variable at `offset` into each use and remove its declaration. */
export function inlineVariable(source: string, languageId: string, offset: number): Edit[] {
  const def = findDefinition(source, languageId, offset);
  if (!def) throw new Error("No variable under the cursor");
  if (!["const", "let", "var", "assign"].includes(def.kind)) throw new Error(`Can't inline a ${def.kind}`);
  const refs = findReferences(source, languageId, def.offset);
  const after = source.slice(def.offset + def.name.length);
  const eq = /^\s*(?::[^=;\n]+)?=(?!=)\s*/.exec(after);
  if (!eq) throw new Error("The variable has no initializer");
  const exprStart = def.offset + def.name.length + eq[0].length;
  const spec = getLanguageSpec(languageId);
  const toks = tokenize(source.slice(exprStart), spec?.lexer);
  let depth = 0;
  let exprEnd = source.length;
  for (const t of toks) {
    if (t.bracket === "open") depth++;
    else if (t.bracket === "close") {
      if (depth === 0) {
        exprEnd = exprStart + t.start;
        break;
      }
      depth--;
    } else if (depth === 0 && (t.value === ";" || t.value === ",")) {
      exprEnd = exprStart + t.start;
      break;
    }
    if (depth === 0 && source.slice(exprStart, exprStart + t.start).includes("\n") && !/[+\-*/&|?:.,(=]\s*$/.test(source.slice(exprStart, exprStart + t.start).trimEnd())) {
      exprEnd = exprStart + source.slice(exprStart, exprStart + t.start).trimEnd().length;
      break;
    }
  }
  const expr = source.slice(exprStart, exprEnd).trim();
  const writes = refs.filter((r) => !r.isDeclaration && /^\s*([+\-*/%]?=(?!=)|\+\+|--)/.test(source.slice(r.to)));
  if (writes.length) throw new Error(`${def.name} is reassigned — can't inline`);
  const simple = /^([\w$.]+|"[^"]*"|'[^']*'|`[^`]*`|\d[\d_.]*|\w+\([^()]*\))$/.test(expr);
  const value = simple ? expr : `(${expr})`;
  // Remove the whole declaration statement (line) when it holds only this declaration.
  const lineStart = source.lastIndexOf("\n", def.offset - 1) + 1;
  let stmtEnd = exprEnd;
  if (source[stmtEnd] === ";") stmtEnd++;
  const lineEnd = source.indexOf("\n", stmtEnd);
  const restOfLine = source.slice(stmtEnd, lineEnd === -1 ? source.length : lineEnd);
  const head = source.slice(lineStart, def.offset);
  if (source[exprEnd] === "," || !/^\s*((export\s+)?(const|let|var)\s+)?$/.test(head) || restOfLine.trim()) throw new Error("Only single-variable declarations on their own line can be inlined");
  const edits: Edit[] = [{ from: lineStart, to: lineEnd === -1 ? source.length : lineEnd + 1, insert: "" }];
  for (const r of refs) if (!r.isDeclaration && r.from !== def.offset) edits.push({ from: r.from, to: r.to, insert: value });
  return edits.sort((a, b) => a.from - b.from);
}

/** Apply non-overlapping edits to a string (any order). */
export function applyEdits(source: string, edits: Edit[]): string {
  let out = source;
  for (const e of [...edits].sort((a, b) => b.from - a.from || b.to - a.to)) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return out;
}
