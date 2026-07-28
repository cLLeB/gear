export type IniData = Record<string, Record<string, string> | string>;

/**
 * Parse a simple INI document into nested sections. Top-level keys live under
 * the root; `[section]` headers create sub-objects. Lines starting with ; or #
 * are comments.
 */
export function parseIni(input: string): IniData {
  const root: Record<string, string> = {};
  const result: IniData = root as IniData;
  let current: Record<string, string> = root;

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;

    const section = /^\[(.+)\]$/.exec(line);
    if (section) {
      const name = section[1].trim();
      const existing = result[name];
      current =
        typeof existing === "object" ? existing : ((result[name] = {}) as Record<string, string>);
      continue;
    }

    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
    current[key] = value;
  }
  return result;
}

/** Serialise nested INI data back into text (root keys first, then sections). */
export function stringifyIni(data: IniData): string {
  const lines: string[] = [];
  const sections: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "object") sections.push(key);
    else lines.push(`${key}=${value}`);
  }
  for (const name of sections) {
    lines.push("", `[${name}]`);
    for (const [k, v] of Object.entries(data[name] as Record<string, string>)) {
      lines.push(`${k}=${v}`);
    }
  }
  return lines.join("\n");
}
