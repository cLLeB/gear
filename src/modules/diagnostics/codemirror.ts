// Bridges Gear's diagnostics engine into CodeMirror's lint system. This is what
// actually draws the coloured underlines in the editor, populates the lint
// gutter, and offers quick fixes in the hover tooltip — for ANY language the
// engine understands, with no external language server required. It composes
// with the LSP integration: LSP diagnostics (when a server is installed) and
// these built-in diagnostics can coexist.

import { linter, type Diagnostic as CmDiagnostic, type Action } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { isAnalyzable } from "@/lib/lang/languages";
import { runDiagnostics, type Diagnostic } from "./index";

/** Map engine diagnostics to CodeMirror diagnostics, wiring quick-fix actions. */
export function diagnosticsToCm(diagnostics: readonly Diagnostic[], docLength: number): CmDiagnostic[] {
  return diagnostics.map((d): CmDiagnostic => {
    const from = Math.max(0, Math.min(d.from, docLength));
    const to = Math.max(from, Math.min(d.to, docLength));

    const actions: Action[] = (d.fixes ?? []).map((fix) => ({
      name: fix.title,
      apply(view: EditorView) {
        view.dispatch({
          changes: fix.edits.map((e) => ({
            from: Math.min(e.from, view.state.doc.length),
            to: Math.min(e.to, view.state.doc.length),
            insert: e.insert,
          })),
        });
      },
    }));

    return {
      from,
      to,
      severity: d.severity,
      message: d.message,
      source: d.code ? `${d.source} (${d.code})` : d.source,
      ...(actions.length ? { actions } : {}),
    };
  });
}

export interface GearLinterOptions {
  /** Debounce before re-linting, in ms. Defaults to 400. */
  delay?: number;
}

/**
 * Build a CodeMirror lint extension for a specific language id. Returns an empty
 * extension for languages the engine cannot analyze, so callers can wire it
 * unconditionally.
 */
export function gearLinter(languageId: string, options: GearLinterOptions = {}): Extension {
  if (!isAnalyzable(languageId) && languageId !== "json") return [];

  return linter(
    (view) => {
      const source = view.state.doc.toString();
      const diagnostics = runDiagnostics(source, languageId);
      return diagnosticsToCm(diagnostics, source.length);
    },
    { delay: options.delay ?? 400 },
  );
}
