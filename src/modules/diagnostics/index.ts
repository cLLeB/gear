// The diagnostics module's public surface: a ready-to-use engine wired with all
// built-in analyzers, plus a convenience runner. Consumers (the editor lint
// integration, the problems panel) call runDiagnostics() and never need to know
// which individual analyzers exist.

import { DiagnosticsEngine, type Diagnostic, type RunOptions } from "./engine";
import { delimiterAnalyzer } from "./analyzers/delimiters";
import { jsonAnalyzer } from "./analyzers/json";
import { lexicalAnalyzer } from "./analyzers/lexical";
import { mergeConflictAnalyzer } from "./analyzers/mergeConflict";
import { createRuleAnalyzer, DEFAULT_RULES } from "./rules";

export * from "./engine";
export * from "./rules";

/** The shared engine with every built-in analyzer registered. */
export const defaultEngine = new DiagnosticsEngine()
  .register(delimiterAnalyzer)
  .register(lexicalAnalyzer)
  .register(mergeConflictAnalyzer)
  .register(jsonAnalyzer)
  .register(createRuleAnalyzer(DEFAULT_RULES));

/** Run all built-in analyzers over a document. */
export function runDiagnostics(source: string, languageId: string, options?: RunOptions): Diagnostic[] {
  return defaultEngine.run(source, languageId, options);
}
