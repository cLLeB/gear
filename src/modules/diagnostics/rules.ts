// A configurable, regex-based lint-rule engine. Each rule matches a pattern and
// emits a diagnostic; rules can be restricted to "code" regions so matches
// inside strings and comments (or vice-versa) are ignored, using the lexer's
// token ranges. Rules may declare a replacement to power a one-click quick fix.
// This turns the diagnostics engine into a user-extensible linter without any
// language-server dependency.

import type { Analyzer, Diagnostic, Severity } from "./engine";

export interface LintRule {
  id: string;
  /** Regex source (global flag is added automatically) or a RegExp. */
  pattern: string | RegExp;
  message: string;
  severity: Severity;
  /** Where the rule is allowed to match. Defaults to "code". */
  scope?: "code" | "comment" | "string" | "any";
  /** Replacement string for a quick fix; `$1` etc. refer to capture groups. */
  replacement?: string;
  fixTitle?: string;
}

function toGlobal(pattern: string | RegExp): RegExp {
  if (pattern instanceof RegExp) {
    const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
    return new RegExp(pattern.source, flags);
  }
  return new RegExp(pattern, "g");
}

interface Region {
  from: number;
  to: number;
  kind: "string" | "comment";
}

function regionAt(regions: Region[], offset: number): Region["kind"] | "code" {
  // Regions are sorted; a small linear scan is fine for typical file sizes.
  for (const r of regions) {
    if (offset >= r.from && offset < r.to) return r.kind;
    if (r.from > offset) break;
  }
  return "code";
}

/**
 * Build an analyzer from a list of lint rules. The returned analyzer is
 * registered like any other and participates in a normal diagnostics run.
 */
export function createRuleAnalyzer(rules: readonly LintRule[], name = "rules"): Analyzer {
  const compiled = rules.map((rule) => ({ rule, re: toGlobal(rule.pattern) }));

  return {
    name,
    analyze(ctx): Diagnostic[] {
      const diagnostics: Diagnostic[] = [];
      const regions: Region[] = ctx.tokens
        .filter((t) => t.type === "string" || t.type === "comment")
        .map((t) => ({ from: t.start, to: t.end, kind: t.type as "string" | "comment" }));

      for (const { rule, re } of compiled) {
        const scope = rule.scope ?? "code";
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(ctx.source)) !== null) {
          if (m[0].length === 0) { re.lastIndex += 1; continue; }
          const where = regionAt(regions, m.index);
          if (scope !== "any" && where !== scope) continue;

          const diagnostic: Diagnostic = {
            from: m.index,
            to: m.index + m[0].length,
            severity: rule.severity,
            message: rule.message,
            code: rule.id,
            source: name,
          };
          if (rule.replacement !== undefined) {
            const insert = m[0].replace(re.global ? new RegExp(re.source, re.flags.replace("g", "")) : re, rule.replacement);
            diagnostic.fixes = [
              { title: rule.fixTitle ?? `Replace with "${insert}"`, edits: [{ from: m.index, to: m.index + m[0].length, insert }] },
            ];
          }
          diagnostics.push(diagnostic);
        }
      }
      return diagnostics;
    },
  };
}

/** A small set of broadly useful default rules. */
export const DEFAULT_RULES: LintRule[] = [
  { id: "no-debugger", pattern: /\bdebugger\b/, message: "Leftover `debugger` statement", severity: "warning", scope: "code" },
  { id: "todo-comment", pattern: /\b(TODO|FIXME|HACK|XXX)\b/, message: "Unresolved TODO/FIXME", severity: "info", scope: "comment" },
  { id: "no-console-log", pattern: /\bconsole\.(log|debug)\b/, message: "Leftover console logging", severity: "hint", scope: "code" },
  { id: "nbsp", pattern: / /, message: "Non-breaking space character", severity: "warning", scope: "any", replacement: " ", fixTitle: "Replace with a normal space" },
];
