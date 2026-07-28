// Extracts a document symbol outline (functions, classes, types, …) from source
// using the shared lexer and language metadata — no per-language grammar. For
// brace languages nesting comes from matching { } ranges; for Python it comes
// from indentation. This drives an outline panel and breadcrumb navigation and
// works offline for every analyzable language.

import { getLanguageSpec } from "./languages";
import { tokenize, type Token } from "./lexer";

export type SymbolKind =
  | "function" | "class" | "interface" | "type" | "enum" | "struct" | "trait" | "module" | "method" | "variable";

export interface DocumentSymbol {
  name: string;
  kind: SymbolKind;
  /** Offset of the declaration keyword. */
  from: number;
  /** Offset of the end of the symbol (body close, or name end when bodyless). */
  to: number;
  children: DocumentSymbol[];
}

const KIND_BY_KEYWORD: Record<string, SymbolKind> = {
  function: "function", fn: "function", def: "function", func: "function",
  class: "class",
  interface: "interface",
  type: "type",
  enum: "enum",
  struct: "struct",
  trait: "trait",
  impl: "class",
  mod: "module",
  module: "module",
  namespace: "module",
};

interface Flat {
  name: string;
  kind: SymbolKind;
  from: number;
  to: number;
}

/** Extract a nested symbol tree from source code for a given language id. */
export function extractSymbols(source: string, languageId: string): DocumentSymbol[] {
  const spec = getLanguageSpec(languageId);
  if (!spec) return [];

  const flat = spec.braceBlocks
    ? extractBraceSymbols(source, tokenize(source, spec.lexer))
    : extractIndentSymbols(source);

  return nest(flat);
}

function extractBraceSymbols(source: string, tokens: Token[]): Flat[] {
  const flat: Flat[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type !== "keyword") continue;
    const kind = KIND_BY_KEYWORD[tok.value];
    if (!kind) continue;

    // The symbol name is the next identifier token.
    let j = i + 1;
    while (j < tokens.length && tokens[j].type !== "identifier") {
      // Stop if we hit a body/terminator before a name (anonymous).
      if (tokens[j].value === "{" || tokens[j].value === ";") break;
      j++;
    }
    if (j >= tokens.length || tokens[j].type !== "identifier") continue;
    const name = tokens[j].value;

    // Determine the body range: next '{' (with its match) before any ';'.
    let bodyClose = tokens[j].end;
    for (let k = j + 1; k < tokens.length; k++) {
      const t = tokens[k];
      if (t.value === ";") break;
      if (t.value === "{") {
        bodyClose = matchBrace(tokens, k);
        break;
      }
      if (t.value === "}") break;
    }
    flat.push({ name, kind, from: tok.start, to: bodyClose });
  }

  // JS/TS: `const name = () => {}` / `= function` style declarations.
  extractArrowAssignments(source, tokens, flat);
  return flat;
}

function matchBrace(tokens: Token[], openIndex: number): number {
  let depth = 0;
  for (let k = openIndex; k < tokens.length; k++) {
    if (tokens[k].value === "{") depth++;
    else if (tokens[k].value === "}") {
      depth--;
      if (depth === 0) return tokens[k].end;
    }
  }
  return tokens[tokens.length - 1]?.end ?? openIndex;
}

function extractArrowAssignments(_source: string, tokens: Token[], flat: Flat[]): void {
  for (let i = 0; i + 3 < tokens.length; i++) {
    if (!(tokens[i].type === "keyword" && ["const", "let", "var"].includes(tokens[i].value))) continue;
    if (tokens[i + 1]?.type !== "identifier") continue;
    if (tokens[i + 2]?.value !== "=") continue;
    // Look ahead for '=>' or 'function' before a statement terminator.
    for (let k = i + 3; k < tokens.length && k < i + 20; k++) {
      const t = tokens[k];
      if (t.value === ";" || t.type === "keyword" && ["const", "let", "var"].includes(t.value)) break;
      if (t.value === "=>" || (t.type === "keyword" && t.value === "function")) {
        let to = tokens[i + 1].end;
        for (let b = k; b < tokens.length; b++) {
          if (tokens[b].value === "{") { to = matchBrace(tokens, b); break; }
          if (tokens[b].value === ";") break;
        }
        flat.push({ name: tokens[i + 1].value, kind: "function", from: tokens[i].start, to });
        break;
      }
    }
  }
}

function extractIndentSymbols(source: string): Flat[] {
  const flat: Flat[] = [];
  const lines = source.split("\n");
  let offset = 0;
  const decls: { indent: number; flatIndex: number }[] = [];

  lines.forEach((line) => {
    const lineStart = offset;
    offset += line.length + 1;

    const m = /^(\s*)(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/.exec(line);
    if (!m) return;
    const indent = m[1].length;
    const kind: SymbolKind = m[2] === "class" ? "class" : "function";
    const entry: Flat = { name: m[3], kind, from: lineStart + m[1].length, to: lineStart + line.length };
    flat.push(entry);
    decls.push({ indent, flatIndex: flat.length - 1 });
  });

  // Extend each declaration's `to` to cover its indented body.
  offset = 0;
  const lineOffsets = lines.map((line) => {
    const s = offset;
    offset += line.length + 1;
    return s;
  });
  decls.forEach(({ indent, flatIndex }) => {
    const declLine = lineOffsets.findIndex((o) => o === flat[flatIndex].from - indent);
    let end = flat[flatIndex].to;
    for (let l = declLine + 1; l < lines.length; l++) {
      if (lines[l].trim() === "") { end = lineOffsets[l] + lines[l].length; continue; }
      const lineIndent = /^\s*/.exec(lines[l])![0].length;
      if (lineIndent <= indent) break;
      end = lineOffsets[l] + lines[l].length;
    }
    flat[flatIndex].to = end;
  });

  return flat;
}

function nest(flat: Flat[]): DocumentSymbol[] {
  const sorted = [...flat].sort((a, b) => a.from - b.from || b.to - a.to);
  const roots: DocumentSymbol[] = [];
  const stack: DocumentSymbol[] = [];

  for (const item of sorted) {
    const node: DocumentSymbol = { ...item, children: [] };
    while (stack.length && stack[stack.length - 1].to <= node.from) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

/** Flatten a symbol tree into a depth-first list (for breadcrumb/quick-open). */
export function flattenSymbols(symbols: readonly DocumentSymbol[]): DocumentSymbol[] {
  const out: DocumentSymbol[] = [];
  const walk = (nodes: readonly DocumentSymbol[]) => {
    for (const n of nodes) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(symbols);
  return out;
}
