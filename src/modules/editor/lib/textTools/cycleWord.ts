// Toggle or cycle the word/operator under the cursor through a set of
// alternatives (true → false, let → const → var, === → !==, GET → POST → …),
// preserving the original's case style. The JetBrains/VS Code "toggle"
// extensions and vim-cycle do the same.

const WORD_GROUPS: readonly (readonly string[])[] = [
  ["true", "false"],
  ["yes", "no"],
  ["on", "off"],
  ["enable", "disable"],
  ["enabled", "disabled"],
  ["show", "hide"],
  ["visible", "hidden"],
  ["open", "close"],
  ["opened", "closed"],
  ["start", "stop"],
  ["begin", "end"],
  ["first", "last"],
  ["min", "max"],
  ["minimum", "maximum"],
  ["left", "right"],
  ["top", "bottom"],
  ["up", "down"],
  ["width", "height"],
  ["row", "column"],
  ["horizontal", "vertical"],
  ["before", "after"],
  ["prev", "next"],
  ["previous", "next"],
  ["add", "remove"],
  ["push", "pop"],
  ["shift", "unshift"],
  ["get", "set"],
  ["read", "write"],
  ["input", "output"],
  ["light", "dark"],
  ["asc", "desc"],
  ["ascending", "descending"],
  ["success", "failure"],
  ["allow", "deny"],
  ["include", "exclude"],
  ["public", "protected", "private"],
  ["let", "const", "var"],
  ["if", "elif", "else"],
  ["and", "or"],
  ["is", "isnt"],
  ["debug", "info", "warn", "error"],
  ["GET", "POST", "PUT", "PATCH", "DELETE"],
  ["px", "rem", "em", "%"],
];

const OPERATOR_GROUPS: readonly (readonly string[])[] = [
  ["===", "!=="],
  ["==", "!="],
  ["<=", ">="],
  ["<", ">"],
  ["&&", "||"],
  ["+=", "-="],
  ["*=", "/="],
  ["++", "--"],
  ["+", "-"],
  ["=>", "->"],
];

type CaseStyle = "lower" | "upper" | "title" | "other";

function caseOf(word: string): CaseStyle {
  if (word === word.toLowerCase()) return "lower";
  if (word === word.toUpperCase()) return "upper";
  if (word[0] === word[0].toUpperCase() && word.slice(1) === word.slice(1).toLowerCase()) return "title";
  return "other";
}

function applyCase(word: string, style: CaseStyle): string {
  if (style === "upper") return word.toUpperCase();
  if (style === "title") return word[0].toUpperCase() + word.slice(1).toLowerCase();
  if (style === "lower") return word.toLowerCase();
  return word;
}

/** The next alternative for a word or operator, or null when it has none. */
export function cycleToken(token: string, direction: 1 | -1 = 1): string | null {
  for (const group of OPERATOR_GROUPS) {
    const i = group.indexOf(token);
    if (i !== -1) return group[(i + direction + group.length) % group.length];
  }
  // HTTP verbs are conventionally upper-case; match them exactly first.
  for (const group of WORD_GROUPS) {
    const i = group.indexOf(token);
    if (i !== -1) return group[(i + direction + group.length) % group.length];
  }
  const lower = token.toLowerCase();
  const style = caseOf(token);
  for (const group of WORD_GROUPS) {
    const i = group.findIndex((w) => w.toLowerCase() === lower);
    if (i !== -1) return applyCase(group[(i + direction + group.length) % group.length], style);
  }
  return null;
}

/** Span of the word or operator run touching `offset` in `line`. */
export function tokenAt(line: string, offset: number): { from: number; to: number; text: string } | null {
  const isWord = (c: string) => /[\w%]/.test(c);
  const isOp = (c: string) => /[=!<>&|+\-*/]/.test(c);
  for (const test of [isWord, isOp]) {
    let from = offset;
    let to = offset;
    // Prefer the token to the left when the cursor sits right after it.
    if (!(to < line.length && test(line[to])) && from > 0 && test(line[from - 1])) {
      from -= 1;
      to = from + 1;
    }
    if (!(to <= line.length && from < line.length && test(line[from]))) continue;
    while (from > 0 && test(line[from - 1])) from--;
    while (to < line.length && test(line[to])) to++;
    return { from, to, text: line.slice(from, to) };
  }
  return null;
}
