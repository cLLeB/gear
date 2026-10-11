// TODO-style markers in comments (the "Todo Tree" / JetBrains TODO view):
// TODO, FIXME, HACK, XXX, BUG, NOTE, OPTIMIZE, REVIEW — with optional
// owner `TODO(alice):` and the comment text that follows.

export const TODO_TAGS = ["FIXME", "BUG", "HACK", "XXX", "TODO", "OPTIMIZE", "REVIEW", "NOTE"] as const;
export type TodoTag = (typeof TODO_TAGS)[number];

export interface TodoMatch {
  tag: TodoTag;
  owner: string | null;
  text: string;
  /** Offset of the tag within the line. */
  index: number;
}

// The tag must follow a comment opener so identifiers like `TODO_LIST` or a
// string "todo" don't count.
const COMMENT_OPENERS = String.raw`(?:\/\/+|\/\*+|#+|--|;+|<!--|%|\*|"""|''')`;
const TODO_RE = new RegExp(
  String.raw`${COMMENT_OPENERS}\s*(?:@)?(${TODO_TAGS.join("|")})\b(?:\(([^)]*)\))?\s*[:\-]?\s*(.*?)\s*(?:\*\/|-->)?\s*$`,
);

export function parseTodo(line: string): TodoMatch | null {
  const m = TODO_RE.exec(line);
  if (!m) return null;
  return {
    tag: m[1] as TodoTag,
    owner: m[2]?.trim() || null,
    text: m[3],
    index: m.index + m[0].indexOf(m[1], m[0].search(/[A-Z]/)),
  };
}

/** Severity for sorting and colouring: lower is more urgent. */
export function todoRank(tag: TodoTag): number {
  return TODO_TAGS.indexOf(tag);
}

/** ripgrep pattern used for the workspace search. */
export const TODO_GREP_PATTERN = `\\b(${TODO_TAGS.join("|")})\\b`;
