// .env files side by side: parsing that keeps every line as written, edits
// that touch only the line they must, and the comparison the pane shows.

export interface EnvLine {
  /** The line exactly as in the file. */
  raw: string;
  key?: string;
  /** The value with quotes removed and escapes applied. */
  value?: string;
}

export interface EnvFile {
  lines: EnvLine[];
  eol: string;
  finalNewline: boolean;
}

const ASSIGN = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/;

function unquote(rest: string): string {
  const s = rest.trim();
  if (s.startsWith('"')) {
    const m = /^"((?:[^"\\]|\\.)*)"/.exec(s);
    if (m) return m[1].replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\(["\\$])/g, "$1");
  }
  if (s.startsWith("'")) {
    const m = /^'([^']*)'/.exec(s);
    if (m) return m[1];
  }
  if (s.startsWith("`")) {
    const m = /^`([^`]*)`/.exec(s);
    if (m) return m[1];
  }
  // Unquoted: a ` #` starts a comment.
  return s.replace(/\s+#.*$/, "").trim();
}

export function parseEnv(text: string): EnvFile {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const finalNewline = /\n$/.test(text);
  const rawLines = text === "" ? [] : text.split(/\r?\n/);
  if (finalNewline) rawLines.pop();
  const lines: EnvLine[] = rawLines.map((raw) => {
    if (/^\s*(#|$)/.test(raw)) return { raw };
    const m = ASSIGN.exec(raw);
    return m ? { raw, key: m[1], value: unquote(m[2]) } : { raw };
  });
  return { lines, eol, finalNewline };
}

export function serializeEnv(f: EnvFile): string {
  if (!f.lines.length) return "";
  return f.lines.map((l) => l.raw).join(f.eol) + (f.finalNewline ? f.eol : "");
}

/** key -> value; when a key is repeated the last one wins, as it does when the file is loaded. */
export function values(f: EnvFile): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of f.lines) if (l.key !== undefined) out[l.key] = l.value ?? "";
  return out;
}

export function duplicates(f: EnvFile): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const l of f.lines)
    if (l.key !== undefined) {
      if (seen.has(l.key)) dup.add(l.key);
      seen.add(l.key);
    }
  return [...dup];
}

/** How a value must be written so that it reads back the same. */
export function quote(value: string): string {
  if (value === "") return "";
  if (/^[A-Za-z0-9_./:@%+,=~-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}"`;
}

/**
 * Sets a key. An existing assignment is rewritten in place (keeping `export`
 * and a trailing comment); a new key is appended. Returns a new file.
 */
export function setValue(f: EnvFile, key: string, value: string): EnvFile {
  let index = -1;
  f.lines.forEach((l, i) => {
    if (l.key === key) index = i;
  });
  if (index < 0) {
    const lines = [...f.lines];
    // Keep a file's trailing blank lines at the end.
    let at = lines.length;
    while (at > 0 && lines[at - 1].raw.trim() === "") at--;
    lines.splice(at, 0, { raw: `${key}=${quote(value)}`, key, value });
    return { ...f, lines, finalNewline: true };
  }
  const old = f.lines[index];
  const prefix = /^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*=\s*)/.exec(old.raw)?.[1] ?? `${key}=`;
  const rest = old.raw.slice(prefix.length);
  // A comment after the value survives: `KEY=old # why` -> `KEY=new # why`.
  const comment = /^(?:"(?:[^"\\]|\\.)*"|'[^']*'|`[^`]*`|[^#]*?)(\s+#.*)$/.exec(rest)?.[1] ?? "";
  const lines = f.lines.map((l, i) => (i === index ? { raw: `${prefix}${quote(value)}${comment}`, key, value } : l));
  return { ...f, lines };
}

/** Removes every assignment of a key. Returns a new file. */
export function removeKey(f: EnvFile, key: string): EnvFile {
  return { ...f, lines: f.lines.filter((l) => l.key !== key) };
}

const TEMPLATE = /\.(example|sample|template|dist|defaults?)$|^(example|sample|template)\.env$/i;

/** `.env.example`, `.env.sample`… — files that list keys without real values. */
export function isTemplate(name: string): boolean {
  return TEMPLATE.test(name);
}

export function isEnvFileName(name: string): boolean {
  return /^\.env(\.[\w.-]+)?$/i.test(name) || /^[\w-]+\.env$/i.test(name);
}

/** The template first, then `.env`, then the rest by name. */
export function orderFiles(names: string[]): string[] {
  const rank = (n: string) => (isTemplate(n) ? 0 : n === ".env" ? 1 : 2);
  return [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export type Cell = "ok" | "missing" | "empty" | "differs";

export interface Row {
  key: string;
  values: Record<string, string | undefined>;
  cells: Record<string, Cell>;
  secret: boolean;
}

const SECRET = /(secret|token|password|passwd|pwd|api[_-]?key|private|credential|auth|signature|salt|dsn|connection|_key$|^key$)/i;

export function looksSecret(key: string): boolean {
  return SECRET.test(key);
}

/**
 * One row per key in any file. A key is "missing" from a file that lacks it,
 * "empty" where it has no value (templates are meant to be empty, so they are
 * not marked), and "differs" where real files disagree.
 */
export function compareEnv(files: Record<string, EnvFile>, order: string[]): Row[] {
  const vals = Object.fromEntries(order.map((n) => [n, values(files[n])]));
  const keys: string[] = [];
  for (const n of order) for (const k of Object.keys(vals[n])) if (!keys.includes(k)) keys.push(k);
  const real = order.filter((n) => !isTemplate(n));
  return keys.map((key) => {
    const present = real.map((n) => vals[n][key]).filter((v): v is string => v !== undefined && v !== "");
    const disagree = new Set(present).size > 1;
    const cells: Record<string, Cell> = {};
    const rowValues: Record<string, string | undefined> = {};
    for (const n of order) {
      const v = vals[n][key];
      rowValues[n] = v;
      if (v === undefined) cells[n] = "missing";
      else if (isTemplate(n)) cells[n] = "ok";
      else if (v === "") cells[n] = "empty";
      else cells[n] = disagree ? "differs" : "ok";
    }
    return { key, values: rowValues, cells, secret: looksSecret(key) };
  });
}

export function mask(value: string): string {
  // Showing the ends of a short value would give most of it away.
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 2)}${"•".repeat(Math.min(12, value.length - 4))}${value.slice(-2)}`;
}

export function keyNameProblem(key: string, existing: string[]): string | null {
  const k = key.trim();
  if (!k) return "Enter a name.";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) return "Use letters, digits and underscores, not starting with a digit.";
  if (existing.includes(k)) return "That variable already exists.";
  return null;
}

export type Filter = "all" | "problems" | "missing" | "differs";

export function filterEnv(rows: Row[], filter: Filter, query: string): Row[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !r.key.toLowerCase().includes(q)) return false;
    const cells = Object.values(r.cells);
    if (filter === "all") return true;
    if (filter === "missing") return cells.includes("missing") || cells.includes("empty");
    if (filter === "differs") return cells.includes("differs");
    return cells.some((c) => c === "missing" || c === "empty");
  });
}
