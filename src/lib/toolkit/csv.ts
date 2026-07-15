export interface CsvOptions {
  /** Field delimiter. Defaults to ",". */
  delimiter?: string;
}

/**
 * Parse RFC-4180-style CSV into rows of string cells. Handles quoted fields
 * containing delimiters, newlines, and escaped double quotes ("").
 */
export function parseCsv(input: string, options: CsvOptions = {}): string[][] {
  const { delimiter = "," } = options;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
    } else if (ch === '"') {
      inQuotes = true;
      i += 1;
    } else if (ch === delimiter) {
      pushField();
      i += 1;
    } else if (ch === "\r") {
      i += 1;
    } else if (ch === "\n") {
      pushRow();
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows;
}

/** Serialise rows into CSV, quoting cells that need it. */
export function stringifyCsv(rows: readonly (readonly string[])[], options: CsvOptions = {}): string {
  const { delimiter = "," } = options;
  const needsQuote = new RegExp(`["${delimiter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n\\r]`);
  return rows
    .map((row) =>
      row
        .map((cell) => (needsQuote.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
        .join(delimiter),
    )
    .join("\n");
}
