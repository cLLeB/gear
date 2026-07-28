/**
 * Remove the common leading whitespace from every line of a block of text.
 * Blank lines are ignored when computing the shared indent. Trailing spaces on
 * otherwise-empty lines are cleared.
 */
export function dedent(text: string): string {
  const lines = text.split("\n");
  let min = Infinity;

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const indent = line.match(/^[ \t]*/)?.[0].length ?? 0;
    if (indent < min) min = indent;
  }

  if (!Number.isFinite(min) || min === 0) {
    return lines.map((l) => (l.trim().length === 0 ? "" : l)).join("\n");
  }

  return lines
    .map((line) => (line.trim().length === 0 ? "" : line.slice(min)))
    .join("\n");
}
