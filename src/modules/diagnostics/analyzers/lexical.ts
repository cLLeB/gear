// Lexical-hygiene diagnostics that apply to virtually every language:
//   - unterminated string literals and block comments (from the lexer)
//   - trailing whitespace at end of lines
//   - mixed tabs and spaces in a file's indentation
//   - missing final newline
// These are the kinds of low-level issues that cause confusing downstream
// parser errors, so surfacing them directly saves real debugging time.

import type { Analyzer, Diagnostic } from "../engine";

export const lexicalAnalyzer: Analyzer = {
  name: "lexical",
  analyze(ctx): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const { source, tokens } = ctx;

    // Unterminated strings / block comments come straight from the lexer.
    for (const token of tokens) {
      if (!token.unterminated) continue;
      diagnostics.push({
        from: token.start,
        to: token.end,
        severity: "error",
        code: token.type === "string" ? "unterminated-string" : "unterminated-comment",
        source: "gear",
        message:
          token.type === "string"
            ? "Unterminated string literal"
            : "Unterminated block comment",
      });
    }

    // Line-based checks.
    let indentStyle: "tab" | "space" | null = null;
    let offset = 0;
    const lines = source.split("\n");

    lines.forEach((line, index) => {
      const lineStart = offset;
      offset += line.length + 1; // +1 for the split newline

      // Trailing whitespace (ignore whitespace-only lines to reduce noise).
      const trailing = /[ \t]+$/.exec(line);
      if (trailing && trailing.index > 0) {
        diagnostics.push({
          from: lineStart + trailing.index,
          to: lineStart + line.length,
          severity: "hint",
          code: "trailing-whitespace",
          source: "gear",
          message: "Trailing whitespace",
          fixes: [
            {
              title: "Remove trailing whitespace",
              edits: [{ from: lineStart + trailing.index, to: lineStart + line.length, insert: "" }],
            },
          ],
        });
      }

      // Indentation consistency across the file.
      const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
      if (indent.includes("\t") && indent.includes(" ")) {
        diagnostics.push({
          from: lineStart,
          to: lineStart + indent.length,
          severity: "warning",
          code: "mixed-indent-line",
          source: "gear",
          message: "Line indentation mixes tabs and spaces",
        });
      } else if (indent.length > 0 && index > 0) {
        const style = indent[0] === "\t" ? "tab" : "space";
        if (indentStyle === null) indentStyle = style;
        else if (indentStyle !== style) {
          diagnostics.push({
            from: lineStart,
            to: lineStart + indent.length,
            severity: "warning",
            code: "inconsistent-indent",
            source: "gear",
            message: `Indentation uses ${style}s but the file started with ${indentStyle}s`,
          });
        }
      }
    });

    // Missing final newline (only for non-empty files).
    if (source.length > 0 && !source.endsWith("\n")) {
      diagnostics.push({
        from: source.length,
        to: source.length,
        severity: "hint",
        code: "no-final-newline",
        source: "gear",
        message: "File does not end with a newline",
        fixes: [{ title: "Add final newline", edits: [{ from: source.length, to: source.length, insert: "\n" }] }],
      });
    }

    return diagnostics;
  },
};
