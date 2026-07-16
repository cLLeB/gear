// Detects unbalanced or mismatched brackets ((), [], {}). Because it consumes
// the lexer's tokens rather than raw text, brackets inside strings and comments
// are correctly ignored — the classic source of false positives in naive
// bracket checkers. Reports the precise offending offset and, where possible,
// offers a quick fix that inserts the missing delimiter.

import type { Analyzer, Diagnostic } from "../engine";

const CLOSE_TO_OPEN: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
const OPEN_TO_CLOSE: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const NAMES: Record<string, string> = {
  "(": "parenthesis",
  ")": "parenthesis",
  "[": "bracket",
  "]": "bracket",
  "{": "brace",
  "}": "brace",
};

interface Frame {
  char: string;
  from: number;
}

export const delimiterAnalyzer: Analyzer = {
  name: "delimiters",
  appliesTo: (_id, spec) => spec !== null,
  analyze(ctx): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const stack: Frame[] = [];

    for (const token of ctx.tokens) {
      if (token.bracket === "open") {
        stack.push({ char: token.value, from: token.start });
      } else if (token.bracket === "close") {
        const expectedOpen = CLOSE_TO_OPEN[token.value];
        const top = stack[stack.length - 1];

        if (!top) {
          diagnostics.push({
            from: token.start,
            to: token.end,
            severity: "error",
            code: "unmatched-close",
            source: "gear",
            message: `Unexpected closing ${NAMES[token.value]} '${token.value}'`,
            fixes: [
              { title: `Remove '${token.value}'`, edits: [{ from: token.start, to: token.end, insert: "" }] },
            ],
          });
        } else if (top.char !== expectedOpen) {
          const wanted = OPEN_TO_CLOSE[top.char];
          diagnostics.push({
            from: token.start,
            to: token.end,
            severity: "error",
            code: "mismatched-bracket",
            source: "gear",
            message: `Mismatched ${NAMES[token.value]}: expected '${wanted}' to close '${top.char}' opened earlier, found '${token.value}'`,
            fixes: [
              { title: `Replace with '${wanted}'`, edits: [{ from: token.start, to: token.end, insert: wanted }] },
            ],
          });
          stack.pop();
        } else {
          stack.pop();
        }
      }
    }

    // Anything left open never closed.
    for (const frame of stack) {
      const wanted = OPEN_TO_CLOSE[frame.char];
      diagnostics.push({
        from: frame.from,
        to: frame.from + 1,
        severity: "error",
        code: "unclosed-bracket",
        source: "gear",
        message: `Unclosed ${NAMES[frame.char]} '${frame.char}' — missing '${wanted}'`,
        fixes: [
          {
            title: `Insert '${wanted}' at end`,
            edits: [{ from: ctx.source.length, to: ctx.source.length, insert: wanted }],
          },
        ],
      });
    }

    return diagnostics;
  },
};
