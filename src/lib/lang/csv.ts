// An RFC 4180 CSV/TSV parser and serializer. Editors constantly open delimited
// data, and the subtle parts — a comma or newline *inside* a quoted field, an
// escaped quote written as `""`, CRLF vs LF line endings, a trailing newline
// that should not produce a phantom empty row — are exactly where naive
// `split(",")` implementations break. This is a single-pass state machine that
// gets those cases right, plus a serializer that quotes only the fields that
// need it and round-trips with the parser.

export interface CsvOptions {
  /** Field delimiter (default ","; use "\t" for TSV). */
  delimiter?: string;
  /** Quote character (default '"'). */
  quote?: string;
  /** Trim surrounding whitespace from unquoted fields. */
  trim?: boolean;
}

/** Parse CSV text into a grid of string cells. */
export function parseCsv(text: string, options: CsvOptions = {}): string[][] {
  const delimiter = options.delimiter ?? ",";
  const quote = options.quote ?? '"';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldWasQuoted = false;
  let i = 0;

  const commitField = () => {
    row.push(options.trim && !fieldWasQuoted ? field.trim() : field);
    field = "";
    fieldWasQuoted = false;
  };
  const commitRow = () => {
    commitField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === quote) {
        if (text[i + 1] === quote) { field += quote; i += 2; continue; } // escaped quote
        inQuotes = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }

    if (c === quote) { inQuotes = true; fieldWasQuoted = true; i += 1; continue; }
    if (c === delimiter) { commitField(); i += 1; continue; }
    if (c === "\r") { if (text[i + 1] === "\n") i += 1; commitRow(); i += 1; continue; }
    if (c === "\n") { commitRow(); i += 1; continue; }
    field += c; i += 1;
  }

  // Flush the final field/row unless the input ended exactly on a row boundary.
  if (field !== "" || fieldWasQuoted || row.length > 0) commitRow();
  return rows;
}

/**
 * Parse CSV using its first row as headers, returning one object per data row.
 * Extra cells beyond the header are ignored; missing cells become "".
 */
export function parseCsvObjects(text: string, options: CsvOptions = {}): Array<Record<string, string>> {
  const grid = parseCsv(text, options);
  if (grid.length === 0) return [];
  const [headers, ...dataRows] = grid;
  return dataRows.map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = cells[i] ?? ""; });
    return obj;
  });
}

/** Serialize a grid of cells to CSV, quoting only fields that require it. */
export function stringifyCsv(rows: ReadonlyArray<ReadonlyArray<string>>, options: CsvOptions = {}): string {
  const delimiter = options.delimiter ?? ",";
  const quote = options.quote ?? '"';
  const needsQuote = (field: string) =>
    field.includes(delimiter) || field.includes(quote) || field.includes("\n") || field.includes("\r");

  const encodeField = (field: string) =>
    needsQuote(field) ? quote + field.split(quote).join(quote + quote) + quote : field;

  return rows.map((row) => row.map(encodeField).join(delimiter)).join("\n");
}

/** Serialize an array of records to CSV with a header row derived from keys. */
export function stringifyCsvObjects(records: ReadonlyArray<Record<string, string>>, options: CsvOptions = {}): string {
  if (records.length === 0) return "";
  const headers = [...new Set(records.flatMap((r) => Object.keys(r)))];
  const rows = [headers, ...records.map((r) => headers.map((h) => r[h] ?? ""))];
  return stringifyCsv(rows, options);
}
