// A lexical scope binder. It walks the shared lexer's tokens and builds a nested
// tree of scopes (global → function/block → …), attaching every binding it can
// recognize (declarations, function parameters, imports) to the scope that owns
// it. This is intentionally heuristic rather than a full type-checker: it uses
// declaration keywords and structural punctuation from the language spec, which
// is enough to power reference finding, unused/undeclared diagnostics, and
// scope-safe rename without a language server.

import { getLanguageSpec, type LanguageSpec } from "./languages";
import { tokenize, type Token } from "./lexer";

export type BindingKind =
  | "var" | "let" | "const" | "function" | "class" | "param" | "import" | "def" | "assign" | "type" | "catch";

export interface Binding {
  name: string;
  kind: BindingKind;
  /** Offset of the binding's defining identifier. */
  offset: number;
  /** Whether re-assignment is legal (informs "assign to const" checks). */
  mutable: boolean;
}

export interface Scope {
  kind: "global" | "function" | "block";
  /** Byte range the scope covers. */
  from: number;
  to: number;
  parent: Scope | null;
  children: Scope[];
  /** name -> bindings declared directly in this scope. */
  bindings: Map<string, Binding[]>;
  /** Whether declarations here hoist to the function (var/function) vs. block. */
  functionScoped: boolean;
}

const FUNCTIONISH = new Set(["function", "fn", "def", "func"]);
const VAR_KINDS: Record<string, BindingKind> = {
  const: "const", let: "let", var: "var", function: "function", class: "class",
  fn: "function", struct: "class", enum: "type", trait: "class", interface: "type",
  type: "type", def: "def", func: "function", mod: "type", impl: "class",
};

function newScope(kind: Scope["kind"], from: number, to: number, parent: Scope | null): Scope {
  return { kind, from, to, parent, children: [], bindings: new Map(), functionScoped: kind !== "block" };
}

function nearestFunctionScope(scope: Scope): Scope {
  let s: Scope | null = scope;
  while (s && !s.functionScoped) s = s.parent;
  return s ?? scope;
}

function addBinding(scope: Scope, b: Binding): void {
  // var/function hoist to the nearest function/global scope; everything else is
  // block scoped where it is written.
  const target = b.kind === "var" || b.kind === "function" ? nearestFunctionScope(scope) : scope;
  const list = target.bindings.get(b.name);
  if (list) list.push(b);
  else target.bindings.set(b.name, [b]);
}

/** Build a lexical scope tree for a document. */
export function buildScopeTree(source: string, languageId: string): Scope {
  const spec = getLanguageSpec(languageId);
  const global = newScope("global", 0, source.length, null);
  if (!spec) return global;
  if (spec.braceBlocks) buildBraceScopes(tokens(source, spec), global);
  else buildIndentScopes(source, global);
  return global;
}

function tokens(source: string, spec: LanguageSpec): Token[] {
  return tokenize(source, spec.lexer);
}

interface PendingParams {
  names: Array<{ name: string; offset: number }>;
}

function buildBraceScopes(toks: Token[], global: Scope): void {
  let current = global;
  // When a function declaration is seen, capture its parameter names so they can
  // be bound into the function scope the moment its '{' opens.
  let pending: PendingParams | null = null;

  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];

    if (tok.type === "keyword" && VAR_KINDS[tok.value]) {
      const kind = VAR_KINDS[tok.value];
      const nameTok = toks[i + 1];
      if (nameTok?.type === "identifier") {
        addBinding(current, { name: nameTok.value, kind, offset: nameTok.start, mutable: kind !== "const" });
      }
      if (FUNCTIONISH.has(tok.value)) pending = { names: collectParamTokens(toks, i) };
      continue;
    }

    // Arrow/expression functions: `(a, b) =>` — capture params for the arrow body.
    if (tok.value === "=>" ) {
      const open = findParamOpenBefore(toks, i);
      if (open >= 0) pending = { names: collectParamsBetween(toks, open) };
      continue;
    }

    if (tok.value === "{") {
      const close = matchClose(toks, i);
      const kind = pending ? "function" : "block";
      const child = newScope(kind, tok.start, close, current);
      current.children.push(child);
      if (pending) {
        for (const p of pending.names) addBinding(child, { name: p.name, kind: "param", offset: p.offset, mutable: true });
        pending = null;
      }
      current = child;
      continue;
    }

    if (tok.value === "}") {
      if (current.parent) current = current.parent;
      continue;
    }
  }
}

/** Identifiers inside the `( … )` that follows a function keyword at `kwIndex`. */
function collectParamTokens(toks: Token[], kwIndex: number): Array<{ name: string; offset: number }> {
  // Find the first '(' after the keyword (skipping the function name).
  let k = kwIndex + 1;
  while (k < toks.length && toks[k].value !== "(" && toks[k].value !== "{" && toks[k].value !== ";") k++;
  if (toks[k]?.value !== "(") return [];
  return collectParamsBetween(toks, k);
}

/** Parameter identifiers between the '(' at `openIndex` and its matching ')'. */
function collectParamsBetween(toks: Token[], openIndex: number): Array<{ name: string; offset: number }> {
  const out: Array<{ name: string; offset: number }> = [];
  let depth = 0;
  let expectName = true; // first identifier of each comma group is the param name
  for (let k = openIndex; k < toks.length; k++) {
    const t = toks[k];
    if (t.value === "(") { depth++; continue; }
    if (t.value === ")") { depth--; if (depth === 0) break; continue; }
    if (depth !== 1) continue;
    if (t.value === ",") { expectName = true; continue; }
    if (expectName && t.type === "identifier") { out.push({ name: t.value, offset: t.start }); expectName = false; }
    if (t.value === ":" || t.value === "=") expectName = false;
  }
  return out;
}

/** For an arrow `=>`, walk back to the '(' that opened its parameter list. */
function findParamOpenBefore(toks: Token[], arrowIndex: number): number {
  // Expect `) =>`; find the ')' just before and match its '('.
  let j = arrowIndex - 1;
  if (toks[j]?.value !== ")") return -1;
  let depth = 0;
  for (let k = j; k >= 0; k--) {
    if (toks[k].value === ")") depth++;
    else if (toks[k].value === "(") { depth--; if (depth === 0) return k; }
  }
  return -1;
}

function matchClose(toks: Token[], openIndex: number): number {
  let depth = 0;
  for (let k = openIndex; k < toks.length; k++) {
    if (toks[k].value === "{") depth++;
    else if (toks[k].value === "}") { depth--; if (depth === 0) return toks[k].end; }
  }
  return toks[toks.length - 1]?.end ?? openIndex;
}

function buildIndentScopes(source: string, global: Scope): void {
  const lines = source.split("\n");
  let offset = 0;
  const stack: { indent: number; scope: Scope }[] = [{ indent: -1, scope: global }];

  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const indent = /^\s*/.exec(line)![0].length;

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack[stack.length - 1].scope.to = lineStart;
      stack.pop();
    }
    const parent = stack[stack.length - 1].scope;

    const def = /^(\s*)(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/.exec(line);
    if (def) {
      const nameOffset = lineStart + line.indexOf(def[3], def[1].length);
      addBinding(parent, { name: def[3], kind: def[2] === "class" ? "class" : "def", offset: nameOffset, mutable: false });
      const child = newScope("function", lineStart + indent, source.length, parent);
      parent.children.push(child);
      stack.push({ indent, scope: child });
      const params = /\(([^)]*)\)/.exec(line);
      if (params) {
        for (const raw of params[1].split(",")) {
          const name = raw.trim().split(/[:=]/)[0].trim().replace(/^\*+/, "");
          if (/^[A-Za-z_]\w*$/.test(name) && name !== "self" && name !== "cls") {
            addBinding(child, { name, kind: "param", offset: nameOffset, mutable: true });
          }
        }
      }
      continue;
    }

    const assign = /^(\s*)([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/.exec(line);
    if (assign && !parent.bindings.get(assign[2])) {
      addBinding(parent, { name: assign[2], kind: "assign", offset: lineStart + assign[1].length, mutable: true });
    }
  }
  while (stack.length > 1) { stack[stack.length - 1].scope.to = source.length; stack.pop(); }
}

/** Find the innermost scope containing `offset`. */
export function scopeAt(root: Scope, offset: number): Scope {
  let node = root;
  outer: for (;;) {
    for (const child of node.children) {
      if (offset >= child.from && offset < child.to) { node = child; continue outer; }
    }
    return node;
  }
}

/** Resolve a name from a scope outward, returning the nearest visible binding. */
export function resolveBinding(scope: Scope, name: string): Binding | null {
  let s: Scope | null = scope;
  while (s) {
    const list = s.bindings.get(name);
    if (list && list.length) return list[list.length - 1];
    s = s.parent;
  }
  return null;
}

/** Flatten every binding in the tree (depth-first). */
export function allBindings(root: Scope): Binding[] {
  const out: Binding[] = [];
  const walk = (s: Scope) => {
    for (const list of s.bindings.values()) out.push(...list);
    for (const c of s.children) walk(c);
  };
  walk(root);
  return out;
}
