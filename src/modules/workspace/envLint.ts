// .env hygiene, in the spirit of dotenv-linter: parse with line numbers, flag
// malformed lines and duplicates, and compare against the committed template
// (.env.example / .env.sample / .env.template) to catch drift — a key a
// teammate added that your local file lacks, or a local key nobody
// documented.

export interface EnvEntry {
  key: string;
  value: string;
  line: number;
}

export type EnvIssueKind =
  | "missing"
  | "undocumented"
  | "duplicate"
  | "malformed"
  | "empty"
  | "unquoted-space"
  | "lowercase-key";

export interface EnvIssue {
  kind: EnvIssueKind;
  file: string;
  line: number | null;
  key: string | null;
  message: string;
}

export function parseEnvLines(text: string): { entries: EnvEntry[]; malformed: Array<{ line: number; text: string }> } {
  const entries: EnvEntry[] = [];
  const malformed: Array<{ line: number; text: string }> = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!m) {
      malformed.push({ line: i + 1, text: raw });
      continue;
    }
    let value = m[2];
    const quote = value[0];
    if ((quote === '"' || quote === "'" || quote === "`") && value.length > 1) {
      const end = value.indexOf(quote, 1);
      if (end === -1) {
        // Multi-line quoted value: consume until the closing quote.
        let j = i + 1;
        let acc = value.slice(1);
        while (j < lines.length && !lines[j].includes(quote)) acc += `\n${lines[j++]}`;
        if (j < lines.length) acc += `\n${lines[j].slice(0, lines[j].indexOf(quote))}`;
        else malformed.push({ line: i + 1, text: raw });
        entries.push({ key: m[1], value: acc, line: i + 1 });
        i = j;
        continue;
      }
      value = value.slice(1, end);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    entries.push({ key: m[1], value, line: i + 1 });
  }
  return { entries, malformed };
}

export function lintEnv(
  file: string,
  text: string,
  template?: { file: string; text: string },
): EnvIssue[] {
  const issues: EnvIssue[] = [];
  const { entries, malformed } = parseEnvLines(text);
  for (const bad of malformed) {
    issues.push({ kind: "malformed", file, line: bad.line, key: null, message: `Not a KEY=value line: ${bad.text.trim().slice(0, 60)}` });
  }
  const seen = new Map<string, number>();
  const rawLines = text.split(/\r?\n/);
  for (const e of entries) {
    const first = seen.get(e.key);
    if (first !== undefined) {
      issues.push({ kind: "duplicate", file, line: e.line, key: e.key, message: `${e.key} is already set on line ${first}; the later value wins` });
    } else {
      seen.set(e.key, e.line);
    }
    if (e.key !== e.key.toUpperCase()) {
      issues.push({ kind: "lowercase-key", file, line: e.line, key: e.key, message: `${e.key} is not upper-case` });
    }
    const rawValue = (rawLines[e.line - 1] ?? "").split("=").slice(1).join("=").trim();
    if (/^[^"'`]\S*\s+\S/.test(rawValue.replace(/\s+#.*$/, ""))) {
      issues.push({ kind: "unquoted-space", file, line: e.line, key: e.key, message: `${e.key} has spaces but is not quoted` });
    }
  }
  if (template) {
    const tpl = parseEnvLines(template.text).entries;
    const tplKeys = new Map(tpl.map((e) => [e.key, e]));
    const localKeys = new Set(entries.map((e) => e.key));
    for (const t of tpl) {
      if (!localKeys.has(t.key)) {
        issues.push({ kind: "missing", file, line: null, key: t.key, message: `${t.key} is in ${template.file} but not in ${file}` });
      }
    }
    for (const e of entries) {
      if (!tplKeys.has(e.key) && seen.get(e.key) === e.line) {
        issues.push({ kind: "undocumented", file, line: e.line, key: e.key, message: `${e.key} is not documented in ${template.file}` });
      }
      if (e.value === "" && tplKeys.has(e.key) && tplKeys.get(e.key)!.value !== "") {
        issues.push({ kind: "empty", file, line: e.line, key: e.key, message: `${e.key} is empty (the template has a value)` });
      }
    }
  }
  return issues;
}

export const ENV_TEMPLATE_NAMES = [".env.example", ".env.sample", ".env.template", ".env.dist", "example.env"];

/** Local env files worth linting, given the names in a directory. */
export function envFilesToLint(names: readonly string[]): { files: string[]; template: string | null } {
  const template = ENV_TEMPLATE_NAMES.find((n) => names.includes(n)) ?? null;
  const files = names
    .filter((n) => n === ".env" || /^\.env\.[\w.-]+$/.test(n))
    .filter((n) => !ENV_TEMPLATE_NAMES.includes(n))
    .sort();
  return { files, template };
}
