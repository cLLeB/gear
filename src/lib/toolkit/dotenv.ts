/**
 * Parse a .env file body into a key/value map. Supports `export` prefixes,
 * single/double quotes (with \n expansion inside double quotes), inline
 * comments, and blank lines.
 */
export function parseDotenv(input: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    const key = match[1];
    let value = match[2];

    if (/^".*"$/.test(value)) {
      value = value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\t/g, "\t");
    } else if (/^'.*'$/.test(value)) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(" #");
      if (hash !== -1) value = value.slice(0, hash);
      value = value.trim();
    }
    out[key] = value;
  }
  return out;
}

/** Serialise a map into .env lines, quoting values that need it. */
export function stringifyDotenv(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => {
      const needsQuote = /[\s#"'\n]/.test(value);
      const safe = needsQuote ? `"${value.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"` : value;
      return `${key}=${safe}`;
    })
    .join("\n");
}
