// A reference resolver built on the lexical scope binder. For every identifier
// occurrence it decides which binding is in effect at that point (respecting
// shadowing) and groups occurrences by their resolved binding. That single index
// powers three editor features at once — find-all-references, go-to-definition,
// and unused-binding detection — entirely offline and language-agnostic.

import { getLanguageSpec } from "./languages";
import { tokenize, type Token } from "./lexer";
import { buildScopeTree, resolveBinding, scopeAt, type Binding, type Scope } from "./scopes";

export interface Occurrence {
  name: string;
  from: number;
  to: number;
  /** True for the occurrence that is the binding's own declaration site. */
  isDeclaration: boolean;
}

export interface SymbolReferences {
  binding: Binding;
  occurrences: Occurrence[];
}

interface Indexed {
  root: Scope;
  tokens: Token[];
  /** Map from a binding (by its declaration offset) to its occurrences. */
  byBinding: Map<number, SymbolReferences>;
}

/** Whether the identifier token at `index` is a property access (`.name`). */
function isPropertyAccess(tokens: Token[], index: number): boolean {
  const prev = tokens[index - 1];
  return !!prev && (prev.value === "." || prev.value === "?." || prev.value === "->");
}

/**
 * Whether the identifier at `index` is an object-literal key (`{ key: … }`).
 * `enclosing` is the nearest unmatched open bracket char. A key inside `{` is a
 * property name, not a variable reference — but the same `name:` pattern inside
 * `(` is a typed parameter and must NOT be skipped.
 */
function isObjectKey(tokens: Token[], index: number, enclosing: string): boolean {
  return enclosing === "{" && tokens[index + 1]?.value === ":";
}

interface InterpolatedName {
  name: string;
  from: number;
  to: number;
}

const IDENT_IN_EXPR = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/** Identifiers in `expr` (starting at `offset`) that are not `.member` accesses. */
function identifiersIn(expr: string, offset: number, out: InterpolatedName[]): void {
  for (const m of expr.matchAll(IDENT_IN_EXPR)) {
    const at = m.index ?? 0;
    if (at > 0 && /[.\w$]/.test(expr[at - 1])) continue;
    out.push({ name: m[0], from: offset + at, to: offset + at + m[0].length });
  }
}

/**
 * Brace-delimited segments of `text` that start at an opener (`${` or `{`),
 * honouring nesting. `{{` is an escaped brace in f-strings and format strings.
 */
function braceSegments(text: string, opener: "${" | "{"): Array<{ body: string; at: number }> {
  const out: Array<{ body: string; at: number }> = [];
  for (let i = 0; i < text.length; i++) {
    if (opener === "{" && text[i] === "{" && text[i + 1] === "{") { i += 1; continue; }
    if (!text.startsWith(opener, i)) continue;
    const start = i + opener.length;
    let depth = 1;
    let j = start;
    for (; j < text.length && depth > 0; j++) {
      if (text[j] === "{") depth += 1;
      else if (text[j] === "}") depth -= 1;
    }
    if (depth !== 0) break;
    out.push({ body: text.slice(start, j - 1), at: start });
    i = j - 1;
  }
  return out;
}

/**
 * Names read inside a string literal through interpolation: JS/TS template
 * literals (`${x}`), Python f-strings (f"{x}"), and Rust inline format args
 * ("{x}" / "{x:?}"). Without these, a variable used only in a string was
 * reported as unused.
 */
function interpolatedNames(tok: Token, prev: Token | undefined, specId: string): InterpolatedName[] {
  const out: InterpolatedName[] = [];
  const text = tok.value;
  if (specId === "javascript" && text.startsWith("`")) {
    for (const seg of braceSegments(text, "${")) identifiersIn(seg.body, tok.start + seg.at, out);
  } else if (specId === "python") {
    const prefixed = prev?.type === "identifier" && prev.end === tok.start && /^(f|rf|fr)$/i.test(prev.value);
    if (!prefixed) return out;
    for (const seg of braceSegments(text, "{")) {
      // Drop the conversion and format spec: f"{x!r:>10}".
      const expr = seg.body.replace(/(![rsa])?(:[^{}]*)?=?\s*$/, "");
      identifiersIn(expr, tok.start + seg.at, out);
    }
  } else if (specId === "rust") {
    // Only a bare identifier is allowed inline in Rust format strings.
    for (const seg of braceSegments(text, "{")) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)(:.*)?$/.exec(seg.body);
      if (m) out.push({ name: m[1], from: tok.start + seg.at, to: tok.start + seg.at + m[1].length });
    }
  }
  return out;
}

function indexDocument(source: string, languageId: string): Indexed | null {
  const spec = getLanguageSpec(languageId);
  if (!spec) return null;
  const tokens = tokenize(source, spec.lexer);
  const root = buildScopeTree(source, languageId);
  const byBinding = new Map<number, SymbolReferences>();
  const bracketStack: string[] = [];

  const record = (name: string, from: number, to: number) => {
    const scope = scopeAt(root, from);
    const binding = resolveBinding(scope, name);
    if (!binding) return;
    let entry = byBinding.get(binding.offset);
    if (!entry) {
      entry = { binding, occurrences: [] };
      byBinding.set(binding.offset, entry);
    }
    entry.occurrences.push({ name, from, to, isDeclaration: from === binding.offset });
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.bracket === "open") { bracketStack.push(tok.value); continue; }
    if (tok.bracket === "close") { bracketStack.pop(); continue; }
    if (tok.type === "string") {
      for (const n of interpolatedNames(tok, tokens[i - 1], spec.id)) record(n.name, n.from, n.to);
      continue;
    }
    if (tok.type !== "identifier") continue;
    if (isPropertyAccess(tokens, i)) continue;
    if (isObjectKey(tokens, i, bracketStack[bracketStack.length - 1] ?? "")) continue;
    record(tok.value, tok.start, tok.end);
  }

  return { root, tokens, byBinding };
}

/** The identifier token covering `offset`, if any. */
function tokenAt(tokens: Token[], offset: number): Token | null {
  for (const t of tokens) {
    if (t.type === "identifier" && offset >= t.start && offset <= t.end) return t;
  }
  return null;
}

/** All occurrences of the symbol at `offset` that resolve to the same binding. */
export function findReferences(source: string, languageId: string, offset: number): Occurrence[] {
  const idx = indexDocument(source, languageId);
  if (!idx) return [];
  const tok = tokenAt(idx.tokens, offset);
  if (!tok) return [];
  const scope = scopeAt(idx.root, tok.start);
  const binding = resolveBinding(scope, tok.value);
  if (!binding) return [];
  return idx.byBinding.get(binding.offset)?.occurrences ?? [];
}

/** The declaration site of the symbol at `offset`, or null. */
export function findDefinition(source: string, languageId: string, offset: number): Binding | null {
  const idx = indexDocument(source, languageId);
  if (!idx) return null;
  const tok = tokenAt(idx.tokens, offset);
  if (!tok) return null;
  return resolveBinding(scopeAt(idx.root, tok.start), tok.value);
}

export interface UnusedBinding {
  binding: Binding;
  reason: "unused-declaration" | "unused-parameter";
}

/**
 * Bindings that are declared but never read. Leading-underscore names are
 * treated as intentionally unused (a widespread convention) and excluded.
 * Parameters are only reported when every later parameter is also unused, since
 * a used trailing parameter forces earlier positional ones to exist.
 */
export function unusedBindings(source: string, languageId: string): UnusedBinding[] {
  const idx = indexDocument(source, languageId);
  if (!idx) return [];
  const out: UnusedBinding[] = [];

  const collect = (scope: Scope) => {
    for (const list of scope.bindings.values()) {
      for (const binding of list) {
        if (binding.name.startsWith("_")) continue;
        const refs = idx.byBinding.get(binding.offset);
        const used = refs?.occurrences.some((o) => !o.isDeclaration) ?? false;
        if (used) continue;
        // Skip exported/top-level type-ish and class/function declarations: they
        // are frequently part of a public surface and reported elsewhere.
        if (scope.kind === "global" && (binding.kind === "function" || binding.kind === "class" || binding.kind === "type")) continue;
        out.push({ binding, reason: binding.kind === "param" ? "unused-parameter" : "unused-declaration" });
      }
    }
    for (const c of scope.children) collect(c);
  };
  collect(idx.root);
  return out.sort((a, b) => a.binding.offset - b.binding.offset);
}
