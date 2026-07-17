// Surfaces the reference engine's unused-binding findings as editor
// diagnostics — a declared-but-never-read local or parameter is reported as a
// hint with an "unused" tag so the editor can render it faded, matching the
// familiar behavior of full language servers but computed entirely offline.

import type { Analyzer, Diagnostic } from "../engine";
import { unusedBindings } from "@/lib/lang/references";

export const unusedSymbolsAnalyzer: Analyzer = {
  name: "unused-symbols",
  appliesTo: (_id, spec) => spec !== null,
  analyze(ctx): Diagnostic[] {
    return unusedBindings(ctx.source, ctx.languageId).map(({ binding, reason }) => ({
      from: binding.offset,
      to: binding.offset + binding.name.length,
      severity: "hint" as const,
      code: reason,
      source: "gear",
      message:
        reason === "unused-parameter"
          ? `Parameter '${binding.name}' is declared but never used`
          : `'${binding.name}' is declared but its value is never read`,
    }));
  },
};
