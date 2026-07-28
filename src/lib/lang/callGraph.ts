// A whole-document call graph. It locates every function definition (named
// declarations, and JS `const f = (…) => …` / `const f = function` forms) and
// every call site, then links callers to callees by name. On top of that graph
// it answers the questions an editor and a refactoring tool actually ask:
// which functions are mutually recursive (strongly connected components via
// Tarjan's algorithm), which are never reached from a set of entry points (dead
// code), and who calls whom. Like the rest of the toolkit it is deliberately
// name-based rather than a resolver: no type information, no cross-file linking —
// but enough to power a call hierarchy, recursion warnings, and unused-function
// diagnostics without a language server.

import { getLanguageSpec } from "./languages";
import { tokenize, type Token } from "./lexer";

export interface FnDef {
  name: string;
  /** Offset of the defining identifier. */
  nameOffset: number;
  /** Byte range of the function body (braces or indented block). */
  from: number;
  to: number;
}

export interface CallSite {
  /** Callee name as written at the call. */
  callee: string;
  /** Offset of the callee identifier. */
  offset: number;
  /** Name of the enclosing function, or null for top-level/module code. */
  caller: string | null;
}

export interface CallGraph {
  functions: FnDef[];
  calls: CallSite[];
  /** caller name -> set of callee names it invokes (resolved to known defs). */
  edges: Map<string, Set<string>>;
}

const FN_KEYWORDS = new Set(["function", "fn", "func"]);
// Names that read like calls but are language constructs, never user functions.
const CONTROL_WORDS = new Set([
  "if", "for", "while", "switch", "catch", "return", "with", "do", "else",
  "match", "when", "await", "typeof", "sizeof", "defer", "go", "select",
]);

/** Build a call graph for a whole document. */
export function buildCallGraph(source: string, languageId: string): CallGraph {
  const spec = getLanguageSpec(languageId);
  if (!spec) return { functions: [], calls: [], edges: new Map() };

  const functions = spec.braceBlocks
    ? braceFunctions(tokenize(source, spec.lexer))
    : indentFunctions(source);

  const known = new Set(functions.map((f) => f.name));
  const calls = spec.braceBlocks
    ? braceCalls(tokenize(source, spec.lexer), functions)
    : indentCalls(source, functions);

  const edges = new Map<string, Set<string>>();
  for (const call of calls) {
    if (call.caller === null || !known.has(call.callee)) continue;
    const set = edges.get(call.caller) ?? new Set<string>();
    set.add(call.callee);
    edges.set(call.caller, set);
  }
  return { functions, calls, edges };
}

// --- Definition discovery --------------------------------------------------

function braceFunctions(toks: Token[]): FnDef[] {
  const out: FnDef[] = [];
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];

    // `function NAME(` / `fn NAME(` / `func NAME(`
    if (tok.type === "keyword" && FN_KEYWORDS.has(tok.value)) {
      const name = toks[i + 1];
      if (name?.type === "identifier") {
        const body = braceBodyAfter(toks, i + 2);
        if (body) out.push({ name: name.value, nameOffset: name.start, ...body });
      }
      continue;
    }

    // `const NAME = (…) =>` or `const NAME = function` (JS/TS assignment forms).
    if (tok.type === "keyword" && (tok.value === "const" || tok.value === "let" || tok.value === "var")) {
      const name = toks[i + 1];
      const eq = toks[i + 2];
      if (name?.type === "identifier" && eq?.value === "=" && isFunctionValue(toks, i + 3)) {
        const body = braceBodyAfter(toks, i + 3);
        if (body) out.push({ name: name.value, nameOffset: name.start, ...body });
      }
    }
  }
  return out;
}

/** Does the token run starting at `i` begin a function value (arrow or `function`)? */
function isFunctionValue(toks: Token[], i: number): boolean {
  if (toks[i]?.value === "function") return true;
  // Look for `=>` before the first statement-ending token on an arrow head.
  if (toks[i]?.value === "(" || toks[i]?.type === "identifier") {
    for (let k = i; k < toks.length && k < i + 200; k++) {
      const v = toks[k].value;
      if (v === "=>") return true;
      if (v === ";" || v === "{" && toks[k - 1]?.value !== ")") return false;
      if (v === ")" && toks[k + 1]?.value === "=>") return true;
    }
  }
  return false;
}

/** Find the `{ … }` body at or after `i`, returning its inner range. */
function braceBodyAfter(toks: Token[], i: number): { from: number; to: number } | null {
  let k = i;
  // Skip past the parameter list and arrow/return-type noise to the first `{`.
  while (k < toks.length && toks[k].value !== "{" && toks[k].value !== ";") k++;
  if (toks[k]?.value !== "{") return null;
  const from = toks[k].start;
  let depth = 0;
  for (; k < toks.length; k++) {
    if (toks[k].value === "{") depth++;
    else if (toks[k].value === "}") { depth--; if (depth === 0) return { from, to: toks[k].end }; }
  }
  return { from, to: toks[toks.length - 1]?.end ?? from };
}

function indentFunctions(source: string): FnDef[] {
  const out: FnDef[] = [];
  const lines = source.split("\n");
  let offset = 0;
  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;
    const m = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)/.exec(line);
    if (!m) continue;
    const indent = m[1].length;
    const nameOffset = lineStart + line.indexOf(m[2], indent);
    out.push({ name: m[2], nameOffset, from: lineStart, to: indentedBlockEnd(lines, lineStart, indent, source) });
  }
  return out;
}

/** End offset of an indented block whose header sits at column `indent`. */
function indentedBlockEnd(lines: string[], headerStart: number, indent: number, source: string): number {
  let offset = 0;
  let started = false;
  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;
    if (lineStart <= headerStart) { if (lineStart === headerStart) started = true; continue; }
    if (!started) continue;
    if (line.trim() === "") continue;
    const col = /^\s*/.exec(line)![0].length;
    if (col <= indent) return lineStart;
  }
  return source.length;
}

// --- Call-site discovery ---------------------------------------------------

function braceCalls(toks: Token[], functions: FnDef[]): CallSite[] {
  const out: CallSite[] = [];
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (tok.type !== "identifier") continue;
    if (toks[i + 1]?.value !== "(") continue;
    // Skip the definition site itself: `function NAME(` or `NAME(` right after a fn keyword.
    const prev = toks[i - 1];
    if (prev?.type === "keyword" && FN_KEYWORDS.has(prev.value)) continue;
    // Skip property/method calls like `obj.method(` — name-based graph can't resolve them.
    if (prev?.value === "." ) continue;
    if (CONTROL_WORDS.has(tok.value)) continue;
    out.push({ callee: tok.value, offset: tok.start, caller: enclosing(functions, tok.start) });
  }
  return out;
}

function indentCalls(source: string, functions: FnDef[]): CallSite[] {
  const out: CallSite[] = [];
  const spec = getLanguageSpec("python")!;
  const toks = tokenize(source, spec.lexer);
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (tok.type !== "identifier") continue;
    if (toks[i + 1]?.value !== "(") continue;
    const prev = toks[i - 1];
    if (prev?.type === "keyword" && prev.value === "def") continue;
    if (prev?.value === ".") continue;
    if (CONTROL_WORDS.has(tok.value)) continue;
    out.push({ callee: tok.value, offset: tok.start, caller: enclosing(functions, tok.start) });
  }
  return out;
}

/** Innermost function whose body contains `offset`, by name; null if top-level. */
function enclosing(functions: FnDef[], offset: number): string | null {
  let best: FnDef | null = null;
  for (const f of functions) {
    if (offset >= f.from && offset < f.to) {
      if (!best || (f.to - f.from) < (best.to - best.from)) best = f;
    }
  }
  return best ? best.name : null;
}

// --- Graph queries ---------------------------------------------------------

/** Names of functions that call `name` (direct callers). */
export function callersOf(graph: CallGraph, name: string): string[] {
  const out: string[] = [];
  for (const [caller, callees] of graph.edges) {
    if (callees.has(name)) out.push(caller);
  }
  return out.sort();
}

/** Names that `name` invokes directly. */
export function calleesOf(graph: CallGraph, name: string): string[] {
  return [...(graph.edges.get(name) ?? [])].sort();
}

/**
 * Strongly connected components of the call graph via Tarjan's algorithm. Any
 * component with more than one member is a set of mutually recursive functions;
 * a single-member component that calls itself is direct recursion. Components
 * are returned in reverse topological order (callees before callers).
 */
export function stronglyConnectedComponents(graph: CallGraph): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  const nodes = graph.functions.map((f) => f.name);

  const strongConnect = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);

    for (const w of graph.edges.get(v) ?? []) {
      if (!index.has(w)) {
        strongConnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }

    if (low.get(v) === index.get(v)) {
      const component: string[] = [];
      for (;;) {
        const w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
        if (w === v) break;
      }
      components.push(component);
    }
  };

  for (const v of nodes) if (!index.has(v)) strongConnect(v);
  return components;
}

/**
 * Groups of mutually recursive functions, plus directly self-recursive ones.
 * Each returned group has at least one cycle: either 2+ members, or a single
 * function that calls itself.
 */
export function recursiveGroups(graph: CallGraph): string[][] {
  const selfLoops = new Set<string>();
  for (const [caller, callees] of graph.edges) if (callees.has(caller)) selfLoops.add(caller);

  return stronglyConnectedComponents(graph)
    .filter((c) => c.length > 1 || selfLoops.has(c[0]))
    .map((c) => [...c].sort());
}

/**
 * Functions not reachable by following call edges from any of `entryPoints`.
 * With no entry points given, every function that is never called by another is
 * treated as a root, so only genuinely orphaned functions are reported.
 */
export function unreachableFunctions(graph: CallGraph, entryPoints?: string[]): string[] {
  const all = new Set(graph.functions.map((f) => f.name));
  const roots = entryPoints && entryPoints.length
    ? entryPoints.filter((e) => all.has(e))
    : rootsFromTopLevel(graph);

  const reachable = new Set<string>();
  const visit = (name: string): void => {
    if (reachable.has(name)) return;
    reachable.add(name);
    for (const callee of graph.edges.get(name) ?? []) visit(callee);
  };
  for (const r of roots) visit(r);

  return [...all].filter((f) => !reachable.has(f)).sort();
}

/** Functions called from top-level (module) code — the implicit entry points. */
function rootsFromTopLevel(graph: CallGraph): string[] {
  const roots = new Set<string>();
  const known = new Set(graph.functions.map((f) => f.name));
  for (const call of graph.calls) {
    if (call.caller === null && known.has(call.callee)) roots.add(call.callee);
  }
  return [...roots];
}
