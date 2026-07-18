// Taint analysis: a forward data-flow pass that tracks whether each variable may
// hold untrusted ("tainted") data and flags when tainted data reaches a
// dangerous sink. It is the classic security analysis behind "this user input
// flows into eval()" warnings. Taint is introduced by *source* calls
// (`readInput()`, `prompt()`, …), propagates through assignments
// (`y = x` taints `y` if `x` is tainted), is cleared by *sanitizer* calls
// (`escape()`, `sanitize()`, …), and is reported when a *sink* call
// (`eval()`, `exec()`, …) receives a tainted variable or a raw source result.
//
// It reuses the structured CFG from dataflow.ts, so branches and loops are
// handled: a variable tainted on any path into a sink is reported.

import { buildCfg, EXIT, type CfgNode } from "./dataflow";
import { getLanguageSpec } from "./languages";
import { tokenize, type Token } from "./lexer";

export interface TaintConfig {
  sources: Set<string>;
  sinks: Set<string>;
  sanitizers: Set<string>;
}

export interface TaintFlow {
  sink: string;
  /** The tainted variable reaching the sink, or null for a direct source→sink call. */
  variable: string | null;
  from: number;
  to: number;
}

export const DEFAULT_TAINT_CONFIG: TaintConfig = {
  sources: new Set(["readInput", "prompt", "getUserInput", "argv", "readFileSync", "recv"]),
  sinks: new Set(["eval", "exec", "execSync", "query", "run", "innerHTML", "dangerouslySetInnerHTML"]),
  sanitizers: new Set(["sanitize", "escape", "encodeURIComponent", "escapeHtml", "parseInt", "Number"]),
};

interface NodeFacts {
  defs: string[];
  rhsVars: string[];
  hasSource: boolean;
  hasSanitizer: boolean;
  sinks: Array<{ name: string; argVars: string[]; hasSourceArg: boolean }>;
}

/** Analyze a document and return every tainted-data-into-sink flow. */
export function analyzeTaint(
  source: string,
  languageId: string,
  config: TaintConfig = DEFAULT_TAINT_CONFIG,
): TaintFlow[] {
  const spec = getLanguageSpec(languageId);
  const nodes = buildCfg(source, languageId);
  if (!spec || nodes.length === 0) return [];

  const facts = new Map<number, NodeFacts>();
  for (const n of nodes) facts.set(n.id, analyzeNode(n, tokenize(source.slice(n.from, n.to), spec.lexer), config));

  const preds = predecessors(nodes);
  const inSets = solveTaint(nodes, facts, preds);

  const flows: TaintFlow[] = [];
  for (const n of nodes) {
    const f = facts.get(n.id)!;
    const tainted = inSets.get(n.id)!;
    for (const sink of f.sinks) {
      if (sink.hasSourceArg) {
        flows.push({ sink: sink.name, variable: null, from: n.from, to: n.to });
      }
      for (const v of sink.argVars) {
        if (tainted.has(v)) flows.push({ sink: sink.name, variable: v, from: n.from, to: n.to });
      }
    }
  }
  return flows;
}

function analyzeNode(node: CfgNode, toks: Token[], config: TaintConfig): NodeFacts {
  const callName = (i: number): string | null =>
    toks[i].type === "identifier" && toks[i + 1]?.value === "(" && toks[i - 1]?.value !== "." ? toks[i].value : null;

  let hasSource = false;
  let hasSanitizer = false;
  const sinks: NodeFacts["sinks"] = [];

  for (let i = 0; i < toks.length; i++) {
    const name = callName(i);
    if (!name) continue;
    if (config.sources.has(name)) hasSource = true;
    if (config.sanitizers.has(name)) hasSanitizer = true;
    if (config.sinks.has(name)) sinks.push(collectSinkArgs(toks, i, config));
  }

  return {
    defs: [...node.defs],
    rhsVars: [...node.uses],
    hasSource,
    hasSanitizer,
    sinks,
  };
}

/** Collect the variable arguments (and any nested source call) of a sink call. */
function collectSinkArgs(toks: Token[], sinkIndex: number, config: TaintConfig): NodeFacts["sinks"][number] {
  const argVars: string[] = [];
  let hasSourceArg = false;
  let depth = 0;
  let started = false;
  for (let k = sinkIndex + 1; k < toks.length; k++) {
    const v = toks[k].value;
    if (v === "(") { depth++; started = true; continue; }
    if (v === ")") { depth--; if (depth === 0) break; continue; }
    if (!started) continue;
    if (toks[k].type === "identifier" && toks[k - 1]?.value !== ".") {
      if (toks[k + 1]?.value === "(") {
        if (config.sources.has(toks[k].value)) hasSourceArg = true;
      } else {
        argVars.push(toks[k].value);
      }
    }
  }
  return { name: toks[sinkIndex].value, argVars, hasSourceArg };
}

function predecessors(nodes: CfgNode[]): Map<number, number[]> {
  const preds = new Map<number, number[]>();
  for (const n of nodes) {
    for (const s of n.succ) {
      if (s === EXIT) continue;
      const list = preds.get(s) ?? [];
      list.push(n.id);
      preds.set(s, list);
    }
  }
  return preds;
}

/** Forward may-analysis fixpoint over tainted variable sets. */
function solveTaint(
  nodes: CfgNode[],
  facts: Map<number, NodeFacts>,
  preds: Map<number, number[]>,
): Map<number, Set<string>> {
  const inSets = new Map<number, Set<string>>();
  const outSets = new Map<number, Set<string>>();
  for (const n of nodes) { inSets.set(n.id, new Set()); outSets.set(n.id, new Set()); }

  const worklist = nodes.map((n) => n.id);
  const inWork = new Set(worklist);
  while (worklist.length) {
    const id = worklist.shift()!;
    inWork.delete(id);

    const inSet = new Set<string>();
    for (const p of preds.get(id) ?? []) for (const v of outSets.get(p) ?? []) inSet.add(v);
    inSets.set(id, inSet);

    const out = new Set(inSet);
    const f = facts.get(id)!;
    if (f.defs.length) {
      const propagated = !f.hasSanitizer && f.rhsVars.some((v) => inSet.has(v));
      const tainted = f.hasSource || propagated;
      for (const d of f.defs) {
        if (tainted) out.add(d);
        else out.delete(d); // reassignment to a clean value clears taint
      }
    }

    if (!sameSet(out, outSets.get(id)!)) {
      outSets.set(id, out);
      for (const s of nodes[id].succ) {
        if (s === EXIT) continue;
        if (!inWork.has(s)) { worklist.push(s); inWork.add(s); }
      }
    }
  }
  return inSets;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
