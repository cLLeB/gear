// CSV / TSV as a grid: parsing (RFC 4180 quoting, any of , ; tab |), writing
// back in the file's own dialect, sorting, filtering and column statistics.

export interface Dialect {
  delimiter: string;
  eol: string;
  finalNewline: boolean;
}

export interface Table {
  rows: string[][];
  dialect: Dialect;
}

const DELIMITERS = [",", ";", "\t", "|"];

/** The delimiter that splits the first lines into the most, and most consistent, columns. */
export function detectDelimiter(text: string, fileName = ""): string {
  if (/\.tsv$/i.test(fileName)) return "\t";
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ",";
  let bestScore = 0;
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => splitLine(l, d).length);
    if (!counts.length || counts[0] < 2) continue;
    const consistent = counts.filter((c) => c === counts[0]).length / counts.length;
    const score = consistent * counts[0];
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function splitLine(line: string, d: string): string[] {
  return parseCsv(line, d).rows[0] ?? [];
}

export function parseCsv(text: string, delimiter?: string, fileName = ""): Table {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const d = delimiter ?? detectDelimiter(body, fileName);
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let wasQuoted = false;
  let i = 0;
  const endCell = () => {
    row.push(cell);
    cell = "";
    wasQuoted = false;
  };
  while (i < body.length) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === "" && !wasQuoted) {
      quoted = true;
      wasQuoted = true;
    } else if (ch === d) endCell();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && body[i + 1] === "\n") i++;
      endCell();
      rows.push(row);
      row = [];
    } else cell += ch;
    i++;
  }
  const finalNewline = body.length > 0 && /[\r\n]$/.test(body) && !quoted;
  if (!finalNewline && (cell !== "" || row.length || wasQuoted)) {
    endCell();
    rows.push(row);
  }
  return { rows, dialect: { delimiter: d, eol, finalNewline } };
}

function quoteCell(cell: string, d: string): string {
  return cell.includes('"') || cell.includes(d) || /[\r\n]/.test(cell) || /^\s|\s$/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function serializeCsv(t: Table): string {
  const { delimiter, eol, finalNewline } = t.dialect;
  const text = t.rows.map((r) => r.map((c) => quoteCell(c, delimiter)).join(delimiter)).join(eol);
  return text + (finalNewline && t.rows.length ? eol : "");
}

/** Every row padded to the widest one. */
export function normalize(rows: string[][]): string[][] {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return rows.map((r) => (r.length === width ? r : [...r, ...Array<string>(width - r.length).fill("")]));
}

/** A number from a cell: "1,234.5", "12%", "$3" and "-4e3" count; "" and "abc" do not. */
export function numeric(cell: string): number | null {
  const s = cell.trim().replace(/^[$€£]/, "").replace(/%$/, "").replace(/,(?=\d{3}\b)/g, "");
  if (s === "" || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  return Number(s);
}

export type SortDir = "asc" | "desc";

/** Row indexes in display order. Numbers sort before text; blanks always last. */
export function sortOrder(rows: string[][], column: number, dir: SortDir): number[] {
  const sign = dir === "asc" ? 1 : -1;
  const keyed = rows.map((r, i) => ({ i, raw: r[column] ?? "", n: numeric(r[column] ?? "") }));
  keyed.sort((a, b) => {
    const ae = a.raw.trim() === "";
    const be = b.raw.trim() === "";
    if (ae || be) return ae === be ? a.i - b.i : ae ? 1 : -1;
    if (a.n !== null && b.n !== null) return (a.n - b.n) * sign || a.i - b.i;
    if (a.n !== null || b.n !== null) return (a.n !== null ? -1 : 1) * sign;
    return a.raw.localeCompare(b.raw, undefined, { numeric: true, sensitivity: "base" }) * sign || a.i - b.i;
  });
  return keyed.map((k) => k.i);
}

/**
 * Rows matching a filter. Plain words must all appear somewhere in the row;
 * `name:ada` restricts a word to the column whose header starts with "name";
 * `age>30`, `age<=5`, `city=Paris`, `city!=Paris` compare one column.
 */
export function filterRows(rows: string[][], header: string[], query: string): number[] {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return rows.map((_, i) => i);
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase().startsWith(name.toLowerCase()));
  const tests = terms.map((term): ((r: string[]) => boolean) => {
    const cmp = /^([^:<>=!]+)(<=|>=|!=|=|<|>)(.*)$/.exec(term);
    if (cmp && col(cmp[1]) >= 0) {
      const c = col(cmp[1]);
      const want = cmp[3];
      const wn = numeric(want);
      return (r) => {
        const got = r[c] ?? "";
        const gn = numeric(got);
        const both = wn !== null && gn !== null;
        switch (cmp[2]) {
          case "=":
            return both ? gn === wn : got.trim().toLowerCase() === want.toLowerCase();
          case "!=":
            return both ? gn !== wn : got.trim().toLowerCase() !== want.toLowerCase();
          case "<":
            return both && gn < wn;
          case "<=":
            return both && gn <= wn;
          case ">":
            return both && gn > wn;
          default:
            return both && gn >= wn;
        }
      };
    }
    const scoped = /^([^:]+):(.*)$/.exec(term);
    if (scoped && col(scoped[1]) >= 0) {
      const c = col(scoped[1]);
      const want = scoped[2].toLowerCase();
      return (r) => (r[c] ?? "").toLowerCase().includes(want);
    }
    const want = term.toLowerCase();
    return (r) => r.some((cell) => cell.toLowerCase().includes(want));
  });
  const out: number[] = [];
  rows.forEach((r, i) => {
    if (tests.every((t) => t(r))) out.push(i);
  });
  return out;
}

export interface ColumnStats {
  filled: number;
  empty: number;
  distinct: number;
  numbers: number;
  min: number | null;
  max: number | null;
  sum: number | null;
  mean: number | null;
  /** The most common values, most frequent first. */
  top: [string, number][];
}

export function columnStats(rows: string[][], column: number): ColumnStats {
  const freq = new Map<string, number>();
  let empty = 0;
  let numbers = 0;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const r of rows) {
    const v = (r[column] ?? "").trim();
    if (v === "") {
      empty++;
      continue;
    }
    freq.set(v, (freq.get(v) ?? 0) + 1);
    const n = numeric(v);
    if (n !== null) {
      numbers++;
      sum += n;
      min = Math.min(min, n);
      max = Math.max(max, n);
    }
  }
  const filled = rows.length - empty;
  return {
    filled,
    empty,
    distinct: freq.size,
    numbers,
    min: numbers ? min : null,
    max: numbers ? max : null,
    sum: numbers ? sum : null,
    mean: numbers ? sum / numbers : null,
    top: [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5),
  };
}

export function setCell(rows: string[][], row: number, column: number, value: string): string[][] {
  if ((rows[row]?.[column] ?? "") === value) return rows;
  return rows.map((r, i) => {
    if (i !== row) return r;
    const next = [...r];
    while (next.length <= column) next.push("");
    next[column] = value;
    return next;
  });
}

export function insertRow(rows: string[][], at: number): string[][] {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 1);
  return [...rows.slice(0, at), Array<string>(width).fill(""), ...rows.slice(at)];
}

export function deleteRow(rows: string[][], at: number): string[][] {
  return rows.filter((_, i) => i !== at);
}

export function insertColumn(rows: string[][], at: number, header = ""): string[][] {
  return rows.map((r, i) => [...r.slice(0, at), i === 0 ? header : "", ...r.slice(at)]);
}

export function deleteColumn(rows: string[][], at: number): string[][] {
  return rows.map((r) => r.filter((_, i) => i !== at));
}

export function moveColumn(rows: string[][], from: number, to: number): string[][] {
  if (from === to || to < 0) return rows;
  return rows.map((r) => {
    if (to >= r.length || from >= r.length) return r;
    const next = [...r];
    const [cell] = next.splice(from, 1);
    next.splice(to, 0, cell);
    return next;
  });
}

/** Spreadsheet-style column names for files without a header row: A, B … Z, AA. */
export function columnLetter(index: number): string {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function toMarkdown(header: string[], rows: string[][]): string {
  const esc = (c: string) => c.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
  const line = (cells: string[]) => `| ${cells.map(esc).join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map((r) => line(header.map((_, i) => r[i] ?? "")))].join("\n");
}

export function delimiterName(d: string): string {
  return d === "," ? "comma" : d === ";" ? "semicolon" : d === "\t" ? "tab" : d === "|" ? "pipe" : JSON.stringify(d);
}
