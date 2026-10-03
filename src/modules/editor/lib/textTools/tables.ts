// Table tools: format Markdown pipe tables (aligned columns honouring the
// `:---`, `:---:`, `---:` alignment row and East Asian wide characters),
// convert CSV/TSV ⇄ Markdown, and pad delimited files into aligned columns
// the way Rainbow CSV's "Align" does.

import { parseCsv, stringifyCsv } from "@/lib/lang/csv";
import { stringWidth } from "@/lib/toolkit/stringWidth";

export type Align = "left" | "center" | "right" | "none";

/** Split one Markdown table row into cells, honouring `\|` escapes and code spans. */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "|") {
      cur += "\\|";
      i++;
    } else if (c === "`") {
      inCode = !inCode;
      cur += c;
    } else if (c === "|" && !inCode) {
      cells.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c.replace(/\s/g, "")));
}

function alignOf(cell: string): Align {
  const c = cell.replace(/\s/g, "");
  const l = c.startsWith(":");
  const r = c.endsWith(":");
  return l && r ? "center" : r ? "right" : l ? "left" : "none";
}

function padCell(text: string, width: number, align: Align): string {
  const gap = Math.max(0, width - stringWidth(text));
  if (align === "right") return " ".repeat(gap) + text;
  if (align === "center") {
    const left = Math.floor(gap / 2);
    return " ".repeat(left) + text + " ".repeat(gap - left);
  }
  return text + " ".repeat(gap);
}

function sepCell(width: number, align: Align): string {
  const w = Math.max(3, width);
  if (align === "center") return `:${"-".repeat(w - 2)}:`;
  if (align === "right") return `${"-".repeat(w - 1)}:`;
  if (align === "left") return `:${"-".repeat(w - 1)}`;
  return "-".repeat(w);
}

function renderMarkdown(header: string[], aligns: Align[], rows: string[][], indent = ""): string {
  const cols = Math.max(header.length, ...rows.map((r) => r.length));
  const norm = (r: string[]) => Array.from({ length: cols }, (_, i) => r[i] ?? "");
  const h = norm(header);
  const body = rows.map(norm);
  const a = Array.from({ length: cols }, (_, i) => aligns[i] ?? "none");
  const widths = Array.from({ length: cols }, (_, i) =>
    Math.max(3, stringWidth(h[i]), ...body.map((r) => stringWidth(r[i]))),
  );
  const line = (cells: string[]) => `${indent}| ${cells.map((c, i) => padCell(c, widths[i], a[i])).join(" | ")} |`;
  return [
    line(h),
    `${indent}| ${widths.map((w, i) => sepCell(w, a[i])).join(" | ")} |`,
    ...body.map(line),
  ].join("\n");
}

/** Re-align a Markdown table. Throws when the text is not a pipe table. */
export function formatMarkdownTable(text: string): string {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2) throw new Error("A table needs a header and a separator row");
  const indent = /^\s*/.exec(lines[0])![0];
  const rows = lines.map(splitRow);
  if (!isSeparatorRow(rows[1])) throw new Error("The second row must be a separator like | --- | --- |");
  return renderMarkdown(rows[0], rows[1].map(alignOf), rows.slice(2), indent);
}

/** Every Markdown table in a document, re-aligned in place. */
export function formatAllMarkdownTables(doc: string): string {
  const lines = doc.split("\n");
  const out: string[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    const looksTable = !inFence && lines[i].includes("|") && i + 1 < lines.length && isSeparatorRow(splitRow(lines[i + 1]));
    if (!looksTable) {
      out.push(lines[i]);
      continue;
    }
    let j = i + 2;
    while (j < lines.length && lines[j].includes("|") && lines[j].trim() !== "") j++;
    out.push(formatMarkdownTable(lines.slice(i, j).join("\n")));
    i = j - 1;
  }
  return out.join("\n");
}

export function guessDelimiter(text: string): string {
  const first = text.split("\n").slice(0, 5).join("\n");
  const counts: Array<[string, number]> = [",", "\t", ";", "|"].map((d) => [d, first.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

export function csvToMarkdown(text: string, delimiter = guessDelimiter(text)): string {
  const rows = parseCsv(text.trim(), { delimiter }).map((r) => r.map((c) => c.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>")));
  if (rows.length === 0) throw new Error("No rows");
  const numericCol = (i: number) =>
    rows.length > 1 && rows.slice(1).every((r) => r[i] === undefined || r[i] === "" || /^-?[\d,.]+%?$/.test(r[i]));
  const aligns = rows[0].map((_, i) => (numericCol(i) ? "right" : "none") as Align);
  return renderMarkdown(rows[0], aligns, rows.slice(1));
}

export function markdownToCsv(text: string, delimiter = ","): string {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  const rows = lines.map(splitRow).filter((r, i) => !(i === 1 && isSeparatorRow(r)));
  return stringifyCsv(rows.map((r) => r.map((c) => c.replace(/\\\|/g, "|").replace(/<br\s*\/?>/g, "\n"))), { delimiter });
}

/**
 * Pad a delimited file so columns line up (Rainbow CSV "Align"). Quoted
 * fields keep their quotes; the result still parses as the same data when
 * the reader trims whitespace.
 */
export function alignDelimited(text: string, delimiter = guessDelimiter(text)): string {
  const rows = parseCsv(text, { delimiter });
  const cells = rows.map((r) => r.map((c) => (/[",\n]|^\s|\s$/.test(c) || c.includes(delimiter) ? `"${c.replace(/"/g, '""')}"` : c)));
  const cols = Math.max(...cells.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, i) => Math.max(...cells.map((r) => stringWidth(r[i] ?? ""))));
  const sep = delimiter === "\t" ? "\t" : `${delimiter} `;
  return cells
    .map((r) => r.map((c, i) => (i === r.length - 1 ? c : c + " ".repeat(widths[i] - stringWidth(c)))).join(sep))
    .join("\n");
}

/** Undo alignDelimited: strip the padding around delimiters. */
export function shrinkDelimited(text: string, delimiter = guessDelimiter(text)): string {
  return stringifyCsv(parseCsv(text, { delimiter, trim: true }), { delimiter });
}
