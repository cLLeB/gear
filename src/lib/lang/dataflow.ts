// Live-variable data-flow analysis over a structured control-flow graph. Unlike
// the coarse reachability pass in cfg.ts, this builds a real CFG — `if`/`else`
// arms, `while`/`for` loops with back edges, `break`/`continue` targets, and
// `return`/`throw` edges to the exit — then runs the classic backward liveness
// fixpoint (a variable is *live* at a point if some path from there reads it
// before overwriting it). On top of liveness it reports **dead stores**:
// assignments whose value is never read on any path, which is the assignment
// equivalent of unreachable code and a strong "you probably meant something
// else" signal.
//
// The extraction is name-based and single-document, matching the rest of the
// toolkit: it reasons about who writes and reads a name, not about types or
// aliasing, and errs toward keeping variables live (fewer false positives).

import { getLanguageSpec } from "./languages";
import { tokenize, type Token } from "./lexer";

export interface CfgNode {
  id: number;
  from: number;
  to: number;
  defs: Set<string>;
  uses: Set<string>;
  succ: number[];
}

/** Sentinel successor id for the function/document exit. */
export const EXIT = -1;

const DECL_KEYWORDS = new Set(["let", "const", "var"]);
const COMPOUND_ASSIGN = new Set([
  "+=", "-=", "*=", "/=", "%=", "**=", "&&=", "||=", "??=", "&=", "|=", "^=", "<<=", ">>=", ">>>=",
]);

// --- CFG construction ------------------------------------------------------

class CfgBuilder {
  readonly nodes: CfgNode[] = [];
  constructor(private readonly t: Token[]) {}

  private add(from: number, to: number, defs: Set<string>, uses: Set<string>): number {
    const id = this.nodes.length;
    this.nodes.push({ id, from, to, defs, uses, succ: [] });
    return id;
  }

  private link(fromIds: number[], target: number): void {
    for (const id of fromIds) if (id !== EXIT && !this.nodes[id].succ.includes(target)) this.nodes[id].succ.push(target);
  }

  /** Parse a sequential statement list in tokens [start, end). */
  parseSeq(start: number, end: number, loop: LoopCtx | null): Fragment {
    let entry: number | null = null;
    let pendingExits: number[] = [];
    let i = start;
    while (i < end) {
      if (this.t[i].value === ";") { i += 1; continue; }
      const stmt = this.parseStatement(i, end, loop);
      i = stmt.next;
      if (stmt.entry === null) continue; // empty construct — control passes through
      this.link(pendingExits, stmt.entry);
      if (entry === null) entry = stmt.entry;
      pendingExits = stmt.exits;
    }
    return { entry, exits: pendingExits, next: end };
  }

  private parseStatement(i: number, end: number, loop: LoopCtx | null): Fragment {
    const tok = this.t[i];

    if (tok.value === "{") {
      const close = this.matchBracket(i, "{", "}");
      const frag = this.parseSeq(i + 1, close, loop);
      return { entry: frag.entry, exits: frag.exits, next: close + 1 };
    }

    if (tok.type === "keyword" && (tok.value === "if")) return this.parseIf(i, end, loop);
    if (tok.type === "keyword" && (tok.value === "while" || tok.value === "for")) return this.parseLoop(i, end);

    if (tok.type === "keyword" && (tok.value === "return" || tok.value === "throw")) {
      const stop = this.stmtEnd(i, end, false);
      const { uses } = extract(this.t, i + 1, stop.at, false);
      const node = this.add(tok.start, this.t[stop.at - 1]?.end ?? tok.end, new Set(), uses);
      this.nodes[node].succ.push(EXIT);
      return { entry: node, exits: [], next: stop.next };
    }

    if (tok.type === "keyword" && tok.value === "break") {
      const stop = this.stmtEnd(i, end, false);
      const node = this.add(tok.start, tok.end, new Set(), new Set());
      if (loop) loop.breakNodes.push(node);
      return { entry: node, exits: [], next: stop.next };
    }

    if (tok.type === "keyword" && tok.value === "continue") {
      const stop = this.stmtEnd(i, end, false);
      const node = this.add(tok.start, tok.end, new Set(), new Set());
      if (loop) this.nodes[node].succ.push(loop.header);
      return { entry: node, exits: [], next: stop.next };
    }

    // Simple statement. It may be a bare statement ending in `;`, or a header
    // that introduces a block body (a function/class declaration, a labelled
    // block). `stmtEnd` in block-aware mode stops at a block-opening `{`.
    const stop = this.stmtEnd(i, end, true);
    if (this.t[stop.at]?.value === "{") {
      const { defs, uses } = extract(this.t, i, stop.at, false);
      const header = this.add(tok.start, this.t[stop.at - 1]?.end ?? tok.end, defs, uses);
      const close = this.matchBracket(stop.at, "{", "}");
      const body = this.parseSeq(stop.at + 1, close, loop);
      if (body.entry !== null) this.link([header], body.entry);
      const exits = body.entry !== null ? body.exits : [header];
      return { entry: header, exits, next: close + 1 };
    }
    const { defs, uses } = extract(this.t, i, stop.at, false);
    const node = this.add(tok.start, this.t[stop.at - 1]?.end ?? tok.end, defs, uses);
    return { entry: node, exits: [node], next: stop.next };
  }

  private parseIf(i: number, end: number, loop: LoopCtx | null): Fragment {
    const open = this.findAfter(i, "(");
    const close = this.matchBracket(open, "(", ")");
    const { uses } = extract(this.t, open + 1, close, true);
    const header = this.add(this.t[i].start, this.t[close].end, new Set(), uses);

    const thenFrag = this.parseStatement(close + 1, end, loop);
    if (thenFrag.entry !== null) this.link([header], thenFrag.entry);
    const thenExits = thenFrag.entry !== null ? thenFrag.exits : [header];

    let next = thenFrag.next;
    let exits: number[];
    if (this.t[next]?.value === "else") {
      const elseFrag = this.parseStatement(next + 1, end, loop);
      if (elseFrag.entry !== null) this.link([header], elseFrag.entry);
      const elseExits = elseFrag.entry !== null ? elseFrag.exits : [header];
      exits = [...thenExits, ...elseExits];
      next = elseFrag.next;
    } else {
      // No else: the header's false branch falls through.
      exits = [...thenExits, header];
    }
    return { entry: header, exits: dedupe(exits), next };
  }

  private parseLoop(i: number, end: number): Fragment {
    const open = this.findAfter(i, "(");
    const close = this.matchBracket(open, "(", ")");
    const { defs, uses } = extract(this.t, open + 1, close, true);
    const header = this.add(this.t[i].start, this.t[close].end, defs, uses);

    const ctx: LoopCtx = { header, breakNodes: [] };
    const body = this.parseStatement(close + 1, end, ctx);
    if (body.entry !== null) {
      this.link([header], body.entry);
      this.link(body.exits, header); // back edge
    } else {
      this.nodes[header].succ.push(header); // empty body loops on itself
    }
    // The loop exits via the header's false branch plus any break.
    return { entry: header, exits: dedupe([header, ...ctx.breakNodes]), next: body.next };
  }

  // --- token helpers ---

  // Find where a statement ends. In `blockAware` mode a `{` at depth 0 that is
  // not preceded by a top-level `=` is treated as a block-body opener (a
  // boundary), which distinguishes `function f() {…}` from `let x = {a:1};`.
  private stmtEnd(i: number, end: number, blockAware: boolean): { at: number; next: number } {
    let depth = 0;
    let sawAssign = false;
    for (let k = i; k < end; k++) {
      const v = this.t[k].value;
      if (v === "(" || v === "[") depth++;
      else if (v === ")" || v === "]") depth--;
      else if (v === "{") {
        if (blockAware && depth === 0 && !sawAssign) return { at: k, next: k };
        depth++;
      } else if (v === "}") {
        if (depth === 0) return { at: k, next: k };
        depth--;
      } else if (v === ";" && depth === 0) return { at: k, next: k + 1 };
      else if (depth === 0 && (v === "=" || COMPOUND_ASSIGN.has(v))) sawAssign = true;
    }
    return { at: end, next: end };
  }

  private findAfter(i: number, value: string): number {
    for (let k = i; k < this.t.length; k++) if (this.t[k].value === value) return k;
    return i;
  }

  private matchBracket(openIndex: number, open: string, close: string): number {
    let depth = 0;
    for (let k = openIndex; k < this.t.length; k++) {
      if (this.t[k].value === open) depth++;
      else if (this.t[k].value === close) { depth--; if (depth === 0) return k; }
    }
    return this.t.length - 1;
  }
}

interface Fragment {
  entry: number | null;
  exits: number[];
  next: number;
}

interface LoopCtx {
  header: number;
  breakNodes: number[];
}

function dedupe(ids: number[]): number[] {
  return [...new Set(ids)];
}

/** Extract def/use variable sets from a statement's token slice [a, b). */
function extract(t: Token[], a: number, b: number, headerMode: boolean): { defs: Set<string>; uses: Set<string> } {
  const defs = new Set<string>();
  const uses = new Set<string>();

  const addUses = (from: number, to: number) => {
    for (let k = from; k < to; k++) {
      const tk = t[k];
      if (tk.type !== "identifier") continue;
      if (t[k - 1]?.value === ".") continue; // property access, not a variable
      uses.add(tk.value);
    }
  };

  if (headerMode) {
    // Loop/if headers: collect declared names as defs and every identifier as a use.
    for (let k = a; k < b; k++) {
      if (t[k].type === "keyword" && DECL_KEYWORDS.has(t[k].value) && t[k + 1]?.type === "identifier") {
        defs.add(t[k + 1].value);
      }
    }
    addUses(a, b);
    return { defs, uses };
  }

  // Declaration: `let x = …` / `const x = …`.
  if (t[a]?.type === "keyword" && DECL_KEYWORDS.has(t[a].value) && t[a + 1]?.type === "identifier") {
    defs.add(t[a + 1].value);
    const eq = findAssign(t, a + 2, b);
    if (eq !== -1) addUses(eq + 1, b);
    return { defs, uses };
  }

  // Assignment to a simple variable: `x = …` / `x += …`.
  const eq = findAssign(t, a, b);
  if (eq !== -1 && eq === a + 1 && t[a]?.type === "identifier") {
    const target = t[a].value;
    defs.add(target);
    if (COMPOUND_ASSIGN.has(t[eq].value)) uses.add(target);
    addUses(eq + 1, b);
    return { defs, uses };
  }

  // Anything else (calls, complex l-values, expressions): all reads.
  addUses(a, b);
  return { defs, uses };
}

/** Index of a top-level assignment operator in [a, b), or -1. */
function findAssign(t: Token[], a: number, b: number): number {
  let depth = 0;
  for (let k = a; k < b; k++) {
    const v = t[k].value;
    if (v === "(" || v === "[" || v === "{") depth++;
    else if (v === ")" || v === "]" || v === "}") depth--;
    else if (depth === 0 && (v === "=" || COMPOUND_ASSIGN.has(v))) return k;
  }
  return -1;
}

/** Build a control-flow graph for a whole document (brace languages only). */
export function buildCfg(source: string, languageId: string): CfgNode[] {
  const spec = getLanguageSpec(languageId);
  if (!spec || !spec.braceBlocks) return [];
  const toks = tokenize(source, spec.lexer).filter((t) => t.type !== "comment");
  const builder = new CfgBuilder(toks);
  builder.parseSeq(0, toks.length, null);
  return builder.nodes;
}

// --- Liveness fixpoint -----------------------------------------------------

export interface Liveness {
  liveIn: Map<number, Set<string>>;
  liveOut: Map<number, Set<string>>;
}

/** Solve backward live-variable analysis to a fixpoint via a worklist. */
export function livenessAnalysis(nodes: CfgNode[]): Liveness {
  const liveIn = new Map<number, Set<string>>();
  const liveOut = new Map<number, Set<string>>();
  for (const n of nodes) { liveIn.set(n.id, new Set()); liveOut.set(n.id, new Set()); }

  const worklist = nodes.map((n) => n.id);
  const inWork = new Set(worklist);

  while (worklist.length) {
    const id = worklist.pop()!;
    inWork.delete(id);
    const node = nodes[id];

    const out = new Set<string>();
    for (const s of node.succ) {
      if (s === EXIT) continue;
      for (const v of liveIn.get(s) ?? []) out.add(v);
    }

    const inSet = new Set(node.uses);
    for (const v of out) if (!node.defs.has(v)) inSet.add(v);

    if (!sameSet(inSet, liveIn.get(id)!)) {
      liveIn.set(id, inSet);
      liveOut.set(id, out);
      // Re-process predecessors (nodes whose succ includes id).
      for (const p of nodes) {
        if (p.succ.includes(id) && !inWork.has(p.id)) { worklist.push(p.id); inWork.add(p.id); }
      }
    } else {
      liveOut.set(id, out);
    }
  }
  return { liveIn, liveOut };
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// --- Dead-store detection --------------------------------------------------

export interface DeadStore {
  name: string;
  from: number;
  to: number;
}

/**
 * Assignments whose stored value is never read on any path. A store to `v` is
 * dead when `v` is not live on exit from its node and the node does not also
 * read `v` (compound assignments like `x += 1` read the old value, so they are
 * never reported).
 */
export function deadStores(source: string, languageId: string): DeadStore[] {
  const nodes = buildCfg(source, languageId);
  if (nodes.length === 0) return [];
  const { liveOut } = livenessAnalysis(nodes);

  const out: DeadStore[] = [];
  for (const node of nodes) {
    const live = liveOut.get(node.id)!;
    for (const v of node.defs) {
      if (node.uses.has(v)) continue; // read-modify-write is not a dead store
      if (!live.has(v)) out.push({ name: v, from: node.from, to: node.to });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}
