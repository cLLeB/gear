/**
 * Pure line-range transforms behind the editor's line commands. Kept apart from
 * the CodeMirror commands so the ordering and edge cases (blank lines, indent,
 * trailing whitespace) are testable without an EditorView.
 *
 * Every function takes and returns the lines of the selected range, never the
 * whole document, and none of them mutate the input array.
 */

/** Locale-aware ordering, with digit runs compared numerically so `item10`
 *  sorts after `item9` rather than after `item1`. */
const COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "variant",
});

export type SortDirection = "asc" | "desc";

export function sortLines(
  lines: readonly string[],
  direction: SortDirection = "asc",
): string[] {
  const sorted = [...lines].sort((a, b) => COLLATOR.compare(a, b));
  return direction === "desc" ? sorted.reverse() : sorted;
}

/** Case-insensitive ordering; ties keep their original relative order. */
export function sortLinesIgnoreCase(
  lines: readonly string[],
  direction: SortDirection = "asc",
): string[] {
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "accent",
  });
  const sorted = [...lines].sort((a, b) => collator.compare(a, b));
  return direction === "desc" ? sorted.reverse() : sorted;
}

/** Drops repeats, keeping the first occurrence and the original order. */
export function uniqueLines(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

export function reverseLines(lines: readonly string[]): string[] {
  return [...lines].reverse();
}

/** Removes trailing spaces and tabs. A line of only whitespace becomes empty. */
export function trimTrailingWhitespace(lines: readonly string[]): string[] {
  return lines.map((line) => line.replace(/[ \t]+$/, ""));
}

/** Deletes lines that are empty or whitespace-only. */
export function removeBlankLines(lines: readonly string[]): string[] {
  return lines.filter((line) => line.trim() !== "");
}

/**
 * Collapses the range onto one line. Leading indentation of the continuation
 * lines is dropped and a single space inserted, matching how editors join
 * wrapped prose and argument lists. Blank lines contribute nothing.
 */
export function joinLines(
  lines: readonly string[],
  separator = " ",
): string[] {
  const parts: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const piece = i === 0 ? lines[i].replace(/\s+$/, "") : lines[i].trim();
    if (piece === "") continue;
    parts.push(piece);
  }
  return [parts.join(separator)];
}

/** True when applying the transform would leave the text unchanged. */
export function isNoop(
  before: readonly string[],
  after: readonly string[],
): boolean {
  if (before.length !== after.length) return false;
  return before.every((line, i) => line === after[i]);
}
