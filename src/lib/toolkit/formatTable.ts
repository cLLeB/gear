import { stringWidth } from "./stringWidth";

export interface TableOptions {
  /** Column headers. When omitted, no header row is rendered. */
  headers?: string[];
  /** Per-column alignment. Defaults to left for all. */
  align?: ("left" | "right")[];
  /** Padding spaces between columns. Defaults to 2. */
  gap?: number;
}

/**
 * Render rows of strings as a monospace-aligned text table, accounting for
 * wide characters. Ideal for CLI-style output in the terminal or AI panel.
 */
export function formatTable(rows: readonly (readonly string[])[], options: TableOptions = {}): string {
  const { headers, align = [], gap = 2 } = options;
  const body = headers ? [headers, ...rows] : [...rows];
  if (body.length === 0) return "";

  const columns = Math.max(...body.map((r) => r.length));
  const widths = new Array(columns).fill(0);
  for (const row of body) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i], stringWidth(cell));
    });
  }

  const pad = (cell: string, i: number): string => {
    const space = " ".repeat(Math.max(0, widths[i] - stringWidth(cell)));
    return align[i] === "right" ? space + cell : cell + space;
  };

  const sep = " ".repeat(gap);
  const render = (row: readonly string[]) =>
    Array.from({ length: columns }, (_, i) => pad(row[i] ?? "", i)).join(sep).trimEnd();

  const lines: string[] = [];
  if (headers) {
    lines.push(render(headers));
    lines.push(widths.map((w) => "-".repeat(w)).join(sep));
    lines.push(...rows.map(render));
  } else {
    lines.push(...body.map(render));
  }
  return lines.join("\n");
}
