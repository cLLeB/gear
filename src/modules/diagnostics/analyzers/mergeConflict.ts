// Detects unresolved Git merge-conflict markers and reports each conflict
// region as a single error anchored at the opening marker. Leaving these in a
// file is one of the most common causes of "my code suddenly won't compile",
// so a dedicated, language-independent check is worth its own analyzer.

import type { Analyzer, Diagnostic } from "../engine";

const START = /^<{7}(?: .*)?$/;
const MIDDLE = /^={7}$/;
const BASE = /^\|{7}(?: .*)?$/;
const END = /^>{7}(?: .*)?$/;

export const mergeConflictAnalyzer: Analyzer = {
  name: "merge-conflict",
  analyze(ctx): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    let offset = 0;
    let openStart: number | null = null;
    let sawMiddle = false;

    for (const line of lines) {
      const lineStart = offset;
      offset += line.length + 1;

      if (START.test(line)) {
        openStart = lineStart;
        sawMiddle = false;
      } else if (openStart !== null && (MIDDLE.test(line) || BASE.test(line))) {
        if (MIDDLE.test(line)) sawMiddle = true;
      } else if (END.test(line) && openStart !== null && sawMiddle) {
        diagnostics.push({
          from: openStart,
          to: lineStart + line.length,
          severity: "error",
          code: "merge-conflict",
          source: "gear",
          message: "Unresolved Git merge conflict marker",
        });
        openStart = null;
        sawMiddle = false;
      }
    }

    // A start marker with no matching end is still a conflict.
    if (openStart !== null) {
      diagnostics.push({
        from: openStart,
        to: openStart + 7,
        severity: "error",
        code: "merge-conflict",
        source: "gear",
        message: "Unterminated Git merge conflict marker",
      });
    }

    return diagnostics;
  },
};
