// Surfaces the recursive-descent JSON parser's errors as editor diagnostics.
// Runs for json/jsonc/json5 documents and maps each structured parse error to a
// diagnostic, downgrading style-only issues (trailing commas in JSONC) to
// warnings. A quick fix is offered for trailing commas.

import { parseJson } from "@/lib/lang/jsonParser";
import type { Analyzer, Diagnostic, Severity } from "../engine";

const JSONC_LANGS = new Set(["jsonc", "json5"]);

const WARNING_CODES = new Set(["json-trailing-comma"]);

export const jsonAnalyzer: Analyzer = {
  name: "json",
  appliesTo: (id) => id === "json" || JSONC_LANGS.has(id),
  analyze(ctx): Diagnostic[] {
    const lenient = JSONC_LANGS.has(ctx.languageId);
    const { errors } = parseJson(ctx.source, {
      allowComments: lenient,
      allowTrailingCommas: ctx.languageId === "json5",
    });

    return errors.map((e): Diagnostic => {
      const severity: Severity = WARNING_CODES.has(e.code) ? "warning" : "error";
      const diagnostic: Diagnostic = {
        from: e.from,
        to: Math.max(e.to, e.from + 1),
        severity,
        message: e.message,
        code: e.code,
        source: "gear-json",
      };
      if (e.code === "json-trailing-comma") {
        diagnostic.fixes = [
          { title: "Remove trailing comma", edits: [{ from: e.from, to: e.to, insert: "" }] },
        ];
      }
      return diagnostic;
    });
  },
};
