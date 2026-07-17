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

function indexDocument(source: string, languageId: string): Indexed | null {
  const spec = getLanguageSpec(languageId);
  if (!spec) return null;
  const tokens = tokenize(source, spec.lexer);
  const root = buildScopeTree(source, languageId);
  const byBinding = new Map<number, SymbolReferences>();
  const bracketStack: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.bracket === "open") { bracketStack.push(tok.value); continue; }
    if (tok.bracket === "close") { bracketStack.pop(); continue; }
    if (tok.type !== "identifier") continue;
    if (isPropertyAccess(tokens, i)) continue;
    if (isObjectKey(tokens, i, bracketStack[bracketStack.length - 1] ?? "")) continue;

    const scope = scopeAt(root, tok.start);
    const binding = resolveBinding(scope, tok.value);
    if (!binding) continue;

    let entry = byBinding.get(binding.offset);
    if (!entry) {
      entry = { binding, occurrences: [] };
      byBinding.set(binding.offset, entry);
    }
    entry.occurrences.push({
      name: tok.value,
      from: tok.start,
      to: tok.end,
      isDeclaration: tok.start === binding.offset,
    });
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
