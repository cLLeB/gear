// Structural (syntax-aware) search and replace with metavariables — the engine
// behind tools like comby and ast-grep, scaled down to the shared lexer. A
// pattern is ordinary code with `$NAME` holes: `console.log($X)` matches any
// `console.log(...)` call and binds `$X` to whatever balanced expression sits
// inside, regardless of whitespace or the specific tokens. A metavariable used
// twice becomes a back-reference (`$X + $X` matches `a + a` but not `a + b`), and
// a rewrite template substitutes the captured text back in. Because matching is
// bracket-aware, `foo($ARGS)` correctly captures `bar(1, 2), 3` as one binding
// rather than stopping at the first inner comma.

import { getLanguageSpec } from "./languages";
import { tokenize, type Token } from "./lexer";

export interface Binding {
  text: string;
  from: number;
  to: number;
}

export interface StructuralMatch {
  from: number;
  to: number;
  bindings: Map<string, Binding>;
}

const METAVAR = /^\$[A-Za-z_]\w*$/;

function isMetavar(tok: Token): boolean {
  return tok.type === "identifier" && METAVAR.test(tok.value);
}

/** Find every non-overlapping match of `pattern` within `source`. */
export function structuralSearch(source: string, languageId: string, pattern: string): StructuralMatch[] {
  const spec = getLanguageSpec(languageId);
  if (!spec) return [];
  const src = tokenize(source, spec.lexer).filter((t) => t.type !== "comment");
  const pat = tokenize(pattern, spec.lexer).filter((t) => t.type !== "comment");
  if (pat.length === 0) return [];

  const matches: StructuralMatch[] = [];
  let si = 0;
  while (si < src.length) {
    const result = matchAt(src, source, pat, si);
    if (result) {
      matches.push(result.match);
      si = Math.max(result.end, si + 1); // non-overlapping
    } else {
      si += 1;
    }
  }
  return matches;
}

interface MatchResult {
  match: StructuralMatch;
  end: number;
}

/** Attempt to match the whole pattern anchored at source index `si`. */
function matchAt(src: Token[], source: string, pat: Token[], si: number): MatchResult | null {
  const bindings = new Map<string, Binding>();
  const end = matchFrom(src, source, pat, 0, si, bindings);
  if (end === null) return null;
  const from = src[si]?.start ?? 0;
  const to = end > si ? src[end - 1].end : from;
  return { match: { from, to, bindings }, end };
}

/**
 * Recursive backtracking match. Returns the source index just past the match,
 * or null. Metavariables capture a balanced run of tokens up to wherever the
 * remaining pattern can match.
 */
function matchFrom(
  src: Token[],
  source: string,
  pat: Token[],
  pi: number,
  si: number,
  bindings: Map<string, Binding>,
): number | null {
  if (pi >= pat.length) return si;

  const pt = pat[pi];

  if (isMetavar(pt)) {
    const name = pt.value;
    // Try every balanced span [si, end) as the capture, shortest first. A
    // metavariable binds at least one token, so it never matches "nothing".
    for (let end = si + 1; end <= src.length; end++) {
      if (!balanced(src, si, end)) {
        // Once a closing bracket drives the span negative it cannot recover.
        if (netDepth(src, si, end) < 0) break;
        continue;
      }
      const text = source.slice(src[si].start, src[end - 1].end);

      const prior = bindings.get(name);
      if (prior && normalize(prior.text) !== normalize(text)) continue; // back-reference mismatch

      const created = !prior;
      if (created) bindings.set(name, { text, from: src[si].start, to: src[end - 1].end });

      const rest = matchFrom(src, source, pat, pi + 1, end, bindings);
      if (rest !== null) return rest;

      if (created) bindings.delete(name);
    }
    return null;
  }

  // Literal token: must match value exactly.
  if (si < src.length && src[si].value === pt.value) {
    return matchFrom(src, source, pat, pi + 1, si + 1, bindings);
  }
  return null;
}

/** Whether tokens [from, to) form a bracket-balanced run (depth 0, never negative). */
function balanced(src: Token[], from: number, to: number): boolean {
  let depth = 0;
  for (let i = from; i < to; i++) {
    if (src[i].bracket === "open") depth++;
    else if (src[i].bracket === "close") { depth--; if (depth < 0) return false; }
  }
  return depth === 0;
}

function netDepth(src: Token[], from: number, to: number): number {
  let depth = 0;
  for (let i = from; i < to; i++) {
    if (src[i].bracket === "open") depth++;
    else if (src[i].bracket === "close") depth--;
  }
  return depth;
}

/** Collapse whitespace so back-reference comparison ignores formatting. */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Replace every structural match of `pattern` with `template`, substituting
 * `$NAME` placeholders in the template with the corresponding captured text.
 */
export function structuralReplace(source: string, languageId: string, pattern: string, template: string): string {
  const matches = structuralSearch(source, languageId, pattern);
  if (matches.length === 0) return source;

  let out = "";
  let cursor = 0;
  for (const match of matches) {
    out += source.slice(cursor, match.from);
    out += renderTemplate(template, match.bindings);
    cursor = match.to;
  }
  out += source.slice(cursor);
  return out;
}

function renderTemplate(template: string, bindings: Map<string, Binding>): string {
  return template.replace(/\$[A-Za-z_]\w*/g, (name) => bindings.get(name)?.text ?? name);
}
