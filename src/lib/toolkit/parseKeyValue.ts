export interface KeyValueOptions {
  /** Separator between key and value. Defaults to "=". */
  separator?: string;
}

/**
 * Parse whitespace- or newline-delimited `key=value` pairs into a record.
 * Values may be single- or double-quoted to include spaces. Later duplicate
 * keys overwrite earlier ones.
 */
export function parseKeyValue(input: string, options: KeyValueOptions = {}): Record<string, string> {
  const { separator = "=" } = options;
  const out: Record<string, string> = {};
  const sep = separator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`([\\w.-]+)${sep}("(?:[^"\\\\]|\\\\.)*"|'[^']*'|\\S+)`, "g");

  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    let value = m[2];
    if (/^".*"$/.test(value)) value = value.slice(1, -1).replace(/\\(.)/g, "$1");
    else if (/^'.*'$/.test(value)) value = value.slice(1, -1);
    out[m[1]] = value;
  }
  return out;
}
