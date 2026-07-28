// A semantic token classifier. The lexer says "identifier"; semantic
// highlighting needs to know an identifier's *role* — is it a function being
// called, a parameter, a property access, a type name, a class? This resolves
// each identifier against the lexical scope binder and layers contextual
// heuristics (property access after `.`, a call before `(`, a class after
// `new`, a type after `:`/`extends`/`as`) to assign that role, plus a
// `declaration` modifier on binding sites. It is the data a "semantic tokens"
// provider emits, computed offline for any analyzable language.

import { getLanguageSpec } from "./languages";
import { tokenize } from "./lexer";
import { buildScopeTree, resolveBinding, scopeAt, type BindingKind } from "./scopes";

export type SemanticType =
  | "function" | "variable" | "parameter" | "property" | "type" | "class" | "namespace"
  | "keyword" | "number" | "string" | "comment";

export interface SemanticToken {
  from: number;
  to: number;
  type: SemanticType;
  modifiers: string[];
}

const TYPE_PRECEDERS = new Set([":", "new", "extends", "implements", "as", "instanceof", "is", "satisfies"]);
const PROP_PRECEDERS = new Set([".", "?.", "->"]);

const BINDING_TO_SEMANTIC: Partial<Record<BindingKind, SemanticType>> = {
  param: "parameter",
  const: "variable", let: "variable", var: "variable", assign: "variable", import: "variable",
  function: "function", def: "function",
  class: "class", type: "type",
};

function startsUpper(name: string): boolean {
  return name[0] >= "A" && name[0] <= "Z";
}

/** Classify every token in the document into semantic tokens. */
export function classifySemanticTokens(source: string, languageId: string): SemanticToken[] {
  const spec = getLanguageSpec(languageId);
  if (!spec) return [];
  const tokens = tokenize(source, spec.lexer);
  const root = buildScopeTree(source, languageId);
  const out: SemanticToken[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const emit = (type: SemanticType, modifiers: string[] = []) =>
      out.push({ from: tok.start, to: tok.end, type, modifiers });

    switch (tok.type) {
      case "comment": emit("comment"); continue;
      case "string": emit("string"); continue;
      case "number": emit("number"); continue;
      case "keyword": emit("keyword"); continue;
      case "identifier": break;
      default: continue; // operators/punctuation are not semantic tokens
    }

    const prev = tokens[i - 1];
    const next = tokens[i + 1];

    // Property access: `obj.name`.
    if (prev && PROP_PRECEDERS.has(prev.value)) {
      emit(next?.value === "(" ? "function" : "property", next?.value === "(" ? ["call"] : []);
      continue;
    }

    // Type position: `: Name`, `new Name`, `extends Name`, `as Name`, …
    if (prev && TYPE_PRECEDERS.has(prev.value)) {
      emit(prev.value === "new" ? "class" : "type");
      continue;
    }

    // Resolve against the scope binder for an accurate role.
    const binding = resolveBinding(scopeAt(root, tok.start), tok.value);
    if (binding) {
      const base = BINDING_TO_SEMANTIC[binding.kind] ?? "variable";
      const modifiers: string[] = [];
      if (tok.start === binding.offset) modifiers.push("declaration");
      if (next?.value === "(" && (base === "variable" || base === "function")) {
        emit("function", modifiers.length ? [...modifiers, "call"] : ["call"]);
      } else {
        emit(base, modifiers);
      }
      continue;
    }

    // Unresolved identifier — fall back to structural cues.
    if (next?.value === "(") { emit("function", ["call"]); continue; }
    if (startsUpper(tok.value)) { emit("class"); continue; }
    emit("variable");
  }

  return out;
}

/** Group semantic tokens by type — handy for building highlight decorations. */
export function groupByType(tokens: readonly SemanticToken[]): Map<SemanticType, SemanticToken[]> {
  const map = new Map<SemanticType, SemanticToken[]>();
  for (const t of tokens) {
    const list = map.get(t.type);
    if (list) list.push(t);
    else map.set(t.type, [t]);
  }
  return map;
}
