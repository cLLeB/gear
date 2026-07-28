// Callable-signature extraction and signature help. It scans the shared lexer's
// tokens for function declarations (keyword-based, arrow assignments, and Python
// defs), parses their parameter lists into structured parameters, and builds an
// index keyed by name. Given a cursor inside a call expression it then finds the
// enclosing call, matches it to a known signature, and reports which parameter
// is active — the data an editor needs to render a signature-help popup, all
// offline and without a language server.

import { getLanguageSpec } from "./languages";
import { tokenize, type Token } from "./lexer";

export interface Param {
  name: string;
  type?: string;
  optional: boolean;
  rest: boolean;
  hasDefault: boolean;
}

export interface CallableSignature {
  name: string;
  params: Param[];
  /** Offset of the declaration name. */
  from: number;
  /** Offset just past the parameter list. */
  to: number;
}

const FN_KEYWORDS = new Set(["function", "fn", "func", "def"]);

/** Parse the parameter tokens between the '(' at `open` and its matching ')'. */
function parseParams(tokens: Token[], open: number): { params: Param[]; end: number } {
  const params: Param[] = [];
  let depth = 0;
  let cur: Token[] = [];
  let end = open;
  for (let k = open; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.value === "(") { depth++; if (depth === 1) continue; }
    if (t.value === ")") { depth--; if (depth === 0) { if (cur.length) params.push(toParam(cur)); end = t.end; break; } }
    if (depth === 1 && t.value === ",") { if (cur.length) params.push(toParam(cur)); cur = []; continue; }
    if (depth >= 1) cur.push(t);
  }
  return { params, end };
}

function toParam(group: Token[]): Param {
  let rest = false;
  let i = 0;
  if (group[0]?.value === "..." || group[0]?.value === "*" || group[0]?.value === "**") { rest = true; i = 1; }
  const nameTok = group[i];
  const name = nameTok?.type === "identifier" ? nameTok.value : (nameTok?.value ?? "");
  // Optional marker `name?` (TS) — a '?' punctuation right after the name.
  const optional = group[i + 1]?.value === "?";
  // Type annotation after ':' up to '=' ; default after '='.
  const colon = group.findIndex((t) => t.value === ":");
  const eq = group.findIndex((t) => t.value === "=");
  let type: string | undefined;
  if (colon >= 0) {
    const typeEnd = eq >= 0 ? eq : group.length;
    type = group.slice(colon + 1, typeEnd).map((t) => t.value).join(" ").trim() || undefined;
  }
  return { name, type, optional: optional || eq >= 0, rest, hasDefault: eq >= 0 };
}

/** Extract every callable signature declared in the document. */
export function extractSignatures(source: string, languageId: string): CallableSignature[] {
  const spec = getLanguageSpec(languageId);
  if (!spec) return [];
  const tokens = tokenize(source, spec.lexer);
  const out: CallableSignature[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    // `function name(...)`, `fn name(...)`, `def name(...)`.
    if (tok.type === "keyword" && FN_KEYWORDS.has(tok.value)) {
      const nameTok = tokens[i + 1];
      if (nameTok?.type === "identifier") {
        const open = findOpenParen(tokens, i + 2);
        if (open >= 0) {
          const { params, end } = parseParams(tokens, open);
          out.push({ name: nameTok.value, params, from: nameTok.start, to: end });
        }
      }
      continue;
    }

    // `const name = (...) =>` / `const name = function (...)`.
    if (tok.type === "keyword" && (tok.value === "const" || tok.value === "let" || tok.value === "var")) {
      const nameTok = tokens[i + 1];
      if (nameTok?.type === "identifier" && tokens[i + 2]?.value === "=") {
        // Find an arrow or function within a short window.
        for (let k = i + 3; k < tokens.length && k < i + 24; k++) {
          if (tokens[k].value === "=>" || (tokens[k].type === "keyword" && tokens[k].value === "function")) {
            const open = tokens[k].value === "=>" ? findOpenParenBackward(tokens, k) : findOpenParen(tokens, k + 1);
            if (open >= 0) {
              const { params, end } = parseParams(tokens, open);
              out.push({ name: nameTok.value, params, from: nameTok.start, to: end });
            }
            break;
          }
          if (tokens[k].value === ";") break;
        }
      }
    }
  }
  return out;
}

function findOpenParen(tokens: Token[], from: number): number {
  for (let k = from; k < tokens.length; k++) {
    if (tokens[k].value === "(") return k;
    if (tokens[k].value === "{" || tokens[k].value === ";") return -1;
  }
  return -1;
}

function findOpenParenBackward(tokens: Token[], arrowIndex: number): number {
  let j = arrowIndex - 1;
  if (tokens[j]?.value !== ")") return -1;
  let depth = 0;
  for (let k = j; k >= 0; k--) {
    if (tokens[k].value === ")") depth++;
    else if (tokens[k].value === "(") { depth--; if (depth === 0) return k; }
  }
  return -1;
}

export interface SignatureHelp {
  signature: CallableSignature;
  activeParameter: number;
}

/**
 * Resolve signature help for a cursor at `offset`. Finds the innermost call
 * whose parenthesis is open at `offset`, identifies the callee name, and counts
 * top-level commas to determine the active parameter.
 */
export function signatureHelpAt(source: string, languageId: string, offset: number): SignatureHelp | null {
  const spec = getLanguageSpec(languageId);
  if (!spec) return null;
  const tokens = tokenize(source, spec.lexer);
  const signatures = extractSignatures(source, languageId);

  // Stack of open calls: each entry is { name, commas } for a '(' preceded by
  // an identifier. Non-call parens push a null marker so nesting stays correct.
  const stack: Array<{ name: string | null; commas: number }> = [];
  for (const tok of tokens) {
    if (tok.start >= offset) break;
    if (tok.value === "(") {
      // Is the previous non-space token an identifier (a callee)?
      stack.push({ name: prevIdentifier(tokens, tok), commas: 0 });
      continue;
    }
    if (tok.value === ")") { stack.pop(); continue; }
    if (tok.value === "," && stack.length) stack[stack.length - 1].commas += 1;
  }

  for (let s = stack.length - 1; s >= 0; s--) {
    const call = stack[s];
    if (!call.name) continue;
    const sig = signatures.find((sg) => sg.name === call.name);
    if (sig) return { signature: sig, activeParameter: call.commas };
  }
  return null;
}

function prevIdentifier(tokens: Token[], paren: Token): string | null {
  const idx = tokens.indexOf(paren);
  const prev = tokens[idx - 1];
  return prev?.type === "identifier" ? prev.value : null;
}
