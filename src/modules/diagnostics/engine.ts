// The diagnostics engine: a language-agnostic framework that runs a set of
// registered analyzers over a document and produces a merged, sorted list of
// diagnostics. It is fully in-process (no language server required), so the
// editor can surface errors for any language instantly and offline. Analyzers
// receive a shared, pre-computed context (tokens, position mapper) so a full
// pass tokenizes the source only once.

import { getLanguageSpec, type LanguageSpec } from "@/lib/lang/languages";
import { tokenize, type Token } from "@/lib/lang/lexer";
import { PositionMapper } from "@/lib/lang/position";

export type Severity = "error" | "warning" | "info" | "hint";

export interface QuickFix {
  title: string;
  edits: Array<{ from: number; to: number; insert: string }>;
}

export interface Diagnostic {
  /** Absolute start offset (inclusive). */
  from: number;
  /** Absolute end offset (exclusive). */
  to: number;
  severity: Severity;
  message: string;
  /** Stable machine-readable code, e.g. "unmatched-bracket". */
  code?: string;
  /** Analyzer or tool that produced this, e.g. "gear". */
  source: string;
  fixes?: QuickFix[];
}

export interface AnalyzerContext {
  source: string;
  languageId: string;
  spec: LanguageSpec | null;
  /** Tokens, lazily computed from the language spec (empty if unsupported). */
  tokens: Token[];
  positions: PositionMapper;
}

export interface Analyzer {
  name: string;
  /** When present, restricts the analyzer to languages it returns true for. */
  appliesTo?: (languageId: string, spec: LanguageSpec | null) => boolean;
  analyze: (ctx: AnalyzerContext) => Diagnostic[];
}

export interface RunOptions {
  /** Cap on returned diagnostics (highest severity kept first). Default 500. */
  limit?: number;
  /** Restrict to a subset of registered analyzers by name. */
  only?: string[];
}

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2, hint: 3 };

export class DiagnosticsEngine {
  private readonly analyzers = new Map<string, Analyzer>();

  register(analyzer: Analyzer): this {
    this.analyzers.set(analyzer.name, analyzer);
    return this;
  }

  unregister(name: string): boolean {
    return this.analyzers.delete(name);
  }

  list(): string[] {
    return [...this.analyzers.keys()];
  }

  /** Build the shared context once per run. */
  private buildContext(source: string, languageId: string): AnalyzerContext {
    const spec = getLanguageSpec(languageId);
    const tokens = spec ? tokenize(source, spec.lexer) : [];
    return { source, languageId, spec, tokens, positions: new PositionMapper(source) };
  }

  run(source: string, languageId: string, options: RunOptions = {}): Diagnostic[] {
    const { limit = 500, only } = options;
    const ctx = this.buildContext(source, languageId);
    const out: Diagnostic[] = [];

    for (const analyzer of this.analyzers.values()) {
      if (only && !only.includes(analyzer.name)) continue;
      if (analyzer.appliesTo && !analyzer.appliesTo(languageId, ctx.spec)) continue;
      try {
        out.push(...analyzer.analyze(ctx));
      } catch {
        // A misbehaving analyzer must never break the whole pass.
      }
    }

    out.sort(
      (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.from - b.from || a.to - b.to,
    );
    return out.slice(0, limit);
  }
}

/** Count diagnostics grouped by severity. */
export function countBySeverity(diagnostics: readonly Diagnostic[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0, hint: 0 };
  for (const d of diagnostics) counts[d.severity] += 1;
  return counts;
}
