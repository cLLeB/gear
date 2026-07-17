// Surfaces the control-flow analyzer's unreachable-code findings as editor
// diagnostics. The heavy lifting lives in the language layer (`cfg`); this
// adapter maps its ranges into the diagnostics the lint integration underlines.

import type { Analyzer, Diagnostic } from "../engine";
import { findUnreachableCode } from "@/lib/lang/cfg";

export const unreachableCodeAnalyzer: Analyzer = {
  name: "unreachable-code",
  appliesTo: (_id, spec) => spec !== null && spec.braceBlocks,
  analyze(ctx): Diagnostic[] {
    return findUnreachableCode(ctx.source, ctx.languageId).map((range) => ({
      from: range.from,
      to: range.to,
      severity: "warning" as const,
      code: "unreachable-code",
      source: "gear",
      message: "Unreachable code — this statement can never execute",
    }));
  },
};
