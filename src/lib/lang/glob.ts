// Glob matching and a .gitignore engine. The file explorer, search, and any
// "exclude these paths" setting need to answer "does this path match this
// pattern?" with the same semantics developers already expect from their shell
// and their .gitignore — which is more subtle than a naive `*`->`.*`:
//
//   *        any run of characters except the path separator
//   **       any run including separators (whole path segments)
//   ?        a single character except the separator
//   [abc]    a character class ([!abc] / [^abc] negates)
//   {a,b,c}  brace alternation (expanded before compilation)
//
// The gitignore matcher layers ordering rules on top: patterns apply in file
// order with the last match winning, `!` re-includes, a leading `/` anchors to
// the root, a trailing `/` restricts a rule to directories, and matching a
// directory ignores everything beneath it.

export class GlobError extends Error {}

// Guards against pathological patterns that would hang or exhaust memory:
// brace expansion is a Cartesian product (can blow up combinatorially) and
// chained `**` compiles to nested quantifiers (catastrophic backtracking).
const MAX_BRACE_EXPANSION = 4096;
const MAX_WILDCARDS = 32;

/** Reject patterns whose regex would be prone to catastrophic backtracking. */
function assertSafePattern(pattern: string): void {
  let wildcards = 0;
  for (let i = 0; i < pattern.length; i++) if (pattern[i] === "*" || pattern[i] === "?") wildcards++;
  if (wildcards > MAX_WILDCARDS) {
    throw new GlobError(`glob pattern has too many wildcards (${wildcards} > ${MAX_WILDCARDS})`);
  }
}

/** Expand `{a,b}` alternation into the list of concrete patterns it denotes. */
export function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf("{");
  if (open === -1) return [pattern];

  // Find the matching close brace, respecting nesting.
  let depth = 0;
  let close = -1;
  for (let i = open; i < pattern.length; i++) {
    if (pattern[i] === "{") depth++;
    else if (pattern[i] === "}") { depth--; if (depth === 0) { close = i; break; } }
  }
  if (close === -1) return [pattern];

  const prefix = pattern.slice(0, open);
  const suffix = pattern.slice(close + 1);
  const options = splitTopLevel(pattern.slice(open + 1, close));

  const results: string[] = [];
  for (const opt of options) {
    for (const tail of expandBraces(suffix)) {
      for (const head of expandBraces(prefix + opt)) {
        results.push(head + tail);
        if (results.length > MAX_BRACE_EXPANSION) {
          throw new GlobError(`glob brace expansion exceeds ${MAX_BRACE_EXPANSION} combinations`);
        }
      }
    }
  }
  return results;
}

/** Split on commas that are not inside a nested brace group. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of body) {
    if (c === "{") depth++;
    else if (c === "}") depth--;
    if (c === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

const REGEX_SPECIAL = new Set([".", "+", "^", "$", "(", ")", "|", "\\"]);

/** Translate a single (brace-free) glob into a regex body (no anchors). */
function translate(pattern: string): string {
  let out = "";
  let i = 0;
  const n = pattern.length;
  while (i < n) {
    if (pattern.startsWith("**/", i)) { out += "(?:[^/]*/)*"; i += 3; continue; }
    if (i + 3 === n && pattern.startsWith("/**", i)) { out += "/.*"; i += 3; continue; }
    if (pattern.startsWith("**", i)) { out += ".*"; i += 2; continue; }

    const c = pattern[i];
    if (c === "*") { out += "[^/]*"; i += 1; continue; }
    if (c === "?") { out += "[^/]"; i += 1; continue; }
    if (c === "[") { const [cls, next] = charClass(pattern, i); out += cls; i = next; continue; }
    out += REGEX_SPECIAL.has(c) ? "\\" + c : c;
    i += 1;
  }
  return out;
}

function charClass(pattern: string, start: number): [string, number] {
  let j = start + 1;
  let negate = false;
  if (pattern[j] === "!" || pattern[j] === "^") { negate = true; j += 1; }
  let body = "";
  if (pattern[j] === "]") { body += "\\]"; j += 1; } // literal ] as first member
  while (j < pattern.length && pattern[j] !== "]") {
    const ch = pattern[j];
    body += ch === "\\" ? "\\\\" : ch;
    j += 1;
  }
  if (j >= pattern.length) return ["\\[", start + 1]; // unterminated: literal '['
  return [`[${negate ? "^" : ""}${body}]`, j + 1];
}

/** Compile a glob to a RegExp that fully matches a whole path. */
export function globToRegExp(pattern: string): RegExp {
  assertSafePattern(pattern);
  const alts = expandBraces(pattern).map(translate);
  return new RegExp(`^(?:${alts.join("|")})$`);
}

/** True if `path` matches `pattern` under full-path glob semantics. */
export function matchGlob(pattern: string, path: string): boolean {
  return globToRegExp(pattern).test(path);
}

// --- .gitignore engine -----------------------------------------------------

interface Rule {
  negated: boolean;
  dirOnly: boolean;
  /** Matches the path exactly (the entry itself). */
  exact: RegExp;
  /** Matches a proper ancestor directory (the path lives under the entry). */
  subtree: RegExp;
}

export class GitignoreMatcher {
  constructor(private readonly rules: Rule[]) {}

  /**
   * Whether `path` (relative, `/`-separated, no leading slash) is ignored.
   * Rules are applied in order; the last one that matches decides, so a later
   * `!pattern` can re-include something an earlier rule excluded.
   */
  ignores(path: string, isDir = false): boolean {
    let ignored = false;
    for (const rule of this.rules) {
      if (this.matches(rule, path, isDir)) ignored = !rule.negated;
    }
    return ignored;
  }

  private matches(rule: Rule, path: string, isDir: boolean): boolean {
    if (rule.subtree.test(path)) return true; // path is under a matched directory
    if (rule.exact.test(path)) return rule.dirOnly ? isDir : true;
    return false;
  }
}

/** Parse .gitignore text into an ordered matcher. */
export function parseGitignore(text: string): GitignoreMatcher {
  const rules: Rule[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    // A single pathological line must not throw the whole parse; skip it.
    try {
      const rule = parseRule(rawLine);
      if (rule) rules.push(rule);
    } catch (e) {
      if (!(e instanceof GlobError)) throw e;
    }
  }
  return new GitignoreMatcher(rules);
}

function parseRule(rawLine: string): Rule | null {
  let line = rawLine;
  if (line.trimStart() === "" || line.trimStart().startsWith("#")) return null;
  // Trailing whitespace is ignored unless backslash-escaped.
  line = line.replace(/(?<!\\)\s+$/, "");
  if (line === "") return null;

  let negated = false;
  if (line.startsWith("!")) { negated = true; line = line.slice(1); }
  if (line.startsWith("\\#") || line.startsWith("\\!")) line = line.slice(1);

  let dirOnly = false;
  if (line.endsWith("/")) { dirOnly = true; line = line.slice(0, -1); }

  const anchored = line.startsWith("/");
  if (anchored) line = line.slice(1);
  const hasInteriorSlash = line.includes("/");
  assertSafePattern(line);

  const body = translate(line);
  const prefix = anchored || hasInteriorSlash ? "^" : "(?:^|.*/)";
  return {
    negated,
    dirOnly,
    exact: new RegExp(`${prefix}${body}$`),
    subtree: new RegExp(`${prefix}${body}/`),
  };
}
