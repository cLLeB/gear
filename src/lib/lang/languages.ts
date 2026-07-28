// Per-language lexer configurations plus lightweight metadata (comment syntax,
// keyword sets, structural traits) that the code-intelligence features share.
// Keyed by the same language ids returned by languageFromExtension().

import type { LexerConfig } from "./lexer";

export interface LanguageSpec {
  id: string;
  lexer: LexerConfig;
  /** Keywords that introduce a new decision branch (for complexity). */
  branchKeywords: ReadonlySet<string>;
  /** Keywords that declare a named symbol (for the outline). */
  declarationKeywords: ReadonlySet<string>;
  /** Whether blocks are delimited by braces (vs. indentation). */
  braceBlocks: boolean;
}

const C_LIKE_STRINGS = [
  { quote: '"', escape: "\\" },
  { quote: "'", escape: "\\" },
];

const JS_KEYWORDS = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "export", "extends", "finally", "for", "function", "if",
  "import", "in", "instanceof", "new", "return", "super", "switch", "this", "throw",
  "try", "typeof", "var", "void", "while", "with", "yield", "let", "static", "async",
  "await", "of", "enum", "interface", "type", "implements", "public", "private",
  "protected", "readonly", "abstract",
]);

const PY_KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break",
  "class", "continue", "def", "del", "elif", "else", "except", "finally", "for",
  "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or",
  "pass", "raise", "return", "try", "while", "with", "yield", "match", "case",
]);

const JS_OPERATORS = [
  "===", "!==", "**=", "...", "&&=", "||=", "??=", ">>>",
  "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "=>", "++", "--",
  "+=", "-=", "*=", "/=", "%=", "**", "<<", ">>", "&=", "|=", "^=",
  "+", "-", "*", "/", "%", "=", "<", ">", "!", "&", "|", "^", "~",
];

const SPECS: Record<string, LanguageSpec> = {
  javascript: {
    id: "javascript",
    lexer: {
      lineComments: ["//"],
      blockComments: [["/*", "*/"]],
      strings: [
        { quote: '"', escape: "\\" },
        { quote: "'", escape: "\\" },
        { quote: "`", escape: "\\", multiline: true },
      ],
      keywords: JS_KEYWORDS,
      operators: JS_OPERATORS,
    },
    branchKeywords: new Set(["if", "else", "for", "while", "case", "catch", "&&", "||", "??", "?"]),
    declarationKeywords: new Set(["function", "class", "const", "let", "var", "interface", "type", "enum"]),
    braceBlocks: true,
  },
  python: {
    id: "python",
    lexer: {
      lineComments: ["#"],
      strings: [
        { quote: '"""', escape: "\\", multiline: true },
        { quote: "'''", escape: "\\", multiline: true },
        { quote: '"', escape: "\\" },
        { quote: "'", escape: "\\" },
      ],
      keywords: PY_KEYWORDS,
      operators: ["**", "//", "==", "!=", "<=", ">=", ":=", "->", "+", "-", "*", "/", "%", "=", "<", ">"],
    },
    branchKeywords: new Set(["if", "elif", "else", "for", "while", "except", "and", "or"]),
    declarationKeywords: new Set(["def", "class"]),
    braceBlocks: false,
  },
  json: {
    id: "json",
    lexer: {
      strings: [{ quote: '"', escape: "\\" }],
      operators: [],
    },
    branchKeywords: new Set(),
    declarationKeywords: new Set(),
    braceBlocks: true,
  },
  rust: {
    id: "rust",
    lexer: {
      lineComments: ["//"],
      blockComments: [["/*", "*/"]],
      strings: [{ quote: '"', escape: "\\" }],
      keywords: new Set([
        "as", "break", "const", "continue", "crate", "else", "enum", "extern", "false",
        "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut",
        "pub", "ref", "return", "self", "static", "struct", "super", "trait", "true",
        "type", "unsafe", "use", "where", "while", "async", "await", "dyn",
      ]),
      operators: JS_OPERATORS,
    },
    branchKeywords: new Set(["if", "else", "for", "while", "match", "loop", "&&", "||"]),
    declarationKeywords: new Set(["fn", "struct", "enum", "trait", "impl", "mod", "const", "static", "type"]),
    braceBlocks: true,
  },
  go: {
    id: "go",
    lexer: {
      lineComments: ["//"],
      blockComments: [["/*", "*/"]],
      strings: [
        { quote: '"', escape: "\\" },
        { quote: "`", multiline: true },
      ],
      keywords: new Set([
        "break", "case", "chan", "const", "continue", "default", "defer", "else",
        "fallthrough", "for", "func", "go", "goto", "if", "import", "interface", "map",
        "package", "range", "return", "select", "struct", "switch", "type", "var",
      ]),
      operators: JS_OPERATORS,
    },
    branchKeywords: new Set(["if", "else", "for", "case", "&&", "||"]),
    declarationKeywords: new Set(["func", "type", "var", "const", "struct", "interface"]),
    braceBlocks: true,
  },
  c: {
    id: "c",
    lexer: {
      lineComments: ["//"],
      blockComments: [["/*", "*/"]],
      strings: C_LIKE_STRINGS,
      keywords: new Set([
        "auto", "break", "case", "char", "const", "continue", "default", "do", "double",
        "else", "enum", "extern", "float", "for", "goto", "if", "int", "long", "register",
        "return", "short", "signed", "sizeof", "static", "struct", "switch", "typedef",
        "union", "unsigned", "void", "volatile", "while",
      ]),
      operators: JS_OPERATORS,
    },
    branchKeywords: new Set(["if", "else", "for", "while", "case", "&&", "||", "?"]),
    declarationKeywords: new Set(["struct", "enum", "union", "typedef"]),
    braceBlocks: true,
  },
};

// Aliases mapping related language ids to a base spec.
const ALIASES: Record<string, string> = {
  typescript: "javascript",
  cpp: "c",
  csharp: "c",
  java: "c",
  go: "go",
};

/** Resolve a LanguageSpec for a language id, or null when unsupported. */
export function getLanguageSpec(languageId: string): LanguageSpec | null {
  const id = languageId.toLowerCase();
  if (SPECS[id]) return SPECS[id];
  const alias = ALIASES[id];
  return alias ? SPECS[alias] : null;
}

/** True when a lexer-based analysis is available for the language. */
export function isAnalyzable(languageId: string): boolean {
  return getLanguageSpec(languageId) !== null;
}

/** All directly supported language ids (excluding aliases). */
export function supportedLanguages(): string[] {
  return Object.keys(SPECS);
}
