// Reaching-definitions analysis and def-use chains. Where liveness (dataflow.ts)
// runs backward to answer "will this value be read?", this runs forward to
// answer the opposite, equally useful question: "for this read, which
// assignments could have produced the value?". It is the classic forward
// may-analysis — out(n) = gen(n) ∪ (in(n) \ kill(n)), meet by union — over the
// same structured CFG. The resulting def-use chains power "go to the assignment
// that feeds this variable", multi-definition awareness (a read after an
// `if` can observe either branch's assignment), and a foundation for constant
// propagation or taint tracking.

import { buildCfg, EXIT, type CfgNode } from "./dataflow";

export interface DefSite {
  variable: string;
  nodeId: number;
  from: number;
  to: number;
}

export interface DefUseChain {
  variable: string;
  use: { from: number; to: number };
  /** Assignment sites whose value may reach this use, source-ordered. */
  definitions: Array<{ from: number; to: number }>;
}

interface Solved {
  nodes: CfgNode[];
  defs: Map<string, DefSite>; // key `${nodeId}:${var}` -> site
  inSets: Map<number, Set<string>>;
}

function defKey(nodeId: number, variable: string): string {
  return `${nodeId}:${variable}`;
}

/** Run the forward reaching-definitions fixpoint over a document's CFG. */
function solve(source: string, languageId: string): Solved | null {
  const nodes = buildCfg(source, languageId);
  if (nodes.length === 0) return null;

  const defs = new Map<string, DefSite>();
  const defsByVar = new Map<string, Set<string>>();
  for (const n of nodes) {
    for (const v of n.defs) {
      const key = defKey(n.id, v);
      defs.set(key, { variable: v, nodeId: n.id, from: n.from, to: n.to });
      const set = defsByVar.get(v) ?? new Set<string>();
      set.add(key);
      defsByVar.set(v, set);
    }
  }

  const preds = new Map<number, number[]>();
  for (const n of nodes) {
    for (const s of n.succ) {
      if (s === EXIT) continue;
      const list = preds.get(s) ?? [];
      list.push(n.id);
      preds.set(s, list);
    }
  }

  const gen = new Map<number, Set<string>>();
  const kill = new Map<number, Set<string>>();
  for (const n of nodes) {
    const g = new Set<string>();
    const k = new Set<string>();
    for (const v of n.defs) {
      g.add(defKey(n.id, v));
      for (const other of defsByVar.get(v) ?? []) if (other !== defKey(n.id, v)) k.add(other);
    }
    gen.set(n.id, g);
    kill.set(n.id, k);
  }

  const inSets = new Map<number, Set<string>>();
  const outSets = new Map<number, Set<string>>();
  for (const n of nodes) { inSets.set(n.id, new Set()); outSets.set(n.id, new Set()); }

  const worklist = nodes.map((n) => n.id);
  const inWork = new Set(worklist);
  while (worklist.length) {
    const id = worklist.shift()!;
    inWork.delete(id);

    const inSet = new Set<string>();
    for (const p of preds.get(id) ?? []) for (const key of outSets.get(p) ?? []) inSet.add(key);
    inSets.set(id, inSet);

    const out = new Set(gen.get(id));
    const killed = kill.get(id)!;
    for (const key of inSet) if (!killed.has(key)) out.add(key);

    if (!sameSet(out, outSets.get(id)!)) {
      outSets.set(id, out);
      // Enqueue successors, whose in-sets depend on this out-set.
      for (const s of nodes[id].succ) {
        if (s === EXIT) continue;
        if (!inWork.has(s)) { worklist.push(s); inWork.add(s); }
      }
    }
  }

  return { nodes, defs, inSets };
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * Def-use chains for every variable read in the document: each use paired with
 * the assignment sites whose value may reach it.
 */
export function reachingDefinitions(source: string, languageId: string): DefUseChain[] {
  const solved = solve(source, languageId);
  if (!solved) return [];
  const { nodes, defs, inSets } = solved;

  const chains: DefUseChain[] = [];
  for (const n of nodes) {
    const inSet = inSets.get(n.id)!;
    for (const v of n.uses) {
      const reaching: Array<{ from: number; to: number }> = [];
      for (const key of inSet) {
        const site = defs.get(key)!;
        if (site.variable === v) reaching.push({ from: site.from, to: site.to });
      }
      reaching.sort((a, b) => a.from - b.from);
      chains.push({ variable: v, use: { from: n.from, to: n.to }, definitions: reaching });
    }
  }
  return chains;
}

/**
 * The assignment sites that may reach a variable read at `offset`. Powers a
 * "jump to the assignment(s) feeding this value" navigation.
 */
export function assignmentsReaching(source: string, languageId: string, offset: number): DefSite[] {
  const solved = solve(source, languageId);
  if (!solved) return [];
  const { nodes, defs, inSets } = solved;

  const node = nodes.find((n) => offset >= n.from && offset <= n.to);
  if (!node) return [];

  // The variable read at the offset — nearest use in the node.
  const out: DefSite[] = [];
  for (const v of node.uses) {
    for (const key of inSets.get(node.id)!) {
      const site = defs.get(key)!;
      if (site.variable === v) out.push(site);
    }
  }
  return out.sort((a, b) => a.from - b.from);
}
