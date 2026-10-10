// Pure helpers for the database client: dialect-aware quoting, splitting a
// script into statements (quotes, comments, Postgres dollar-quoting), the
// statement under the cursor, turning grid edits into UPDATE / INSERT / DELETE,
// and spotting destructive statements.

export type Dialect = "postgres" | "mysql" | "sqlite";

export function quoteIdent(name: string, d: Dialect): string {
  return d === "mysql" ? `\`${name.replace(/`/g, "``")}\`` : `"${name.replace(/"/g, '""')}"`;
}

export function qualified(schema: string | null, table: string, d: Dialect): string {
  return schema && !(d === "sqlite" && schema === "main") ? `${quoteIdent(schema, d)}.${quoteIdent(table, d)}` : quoteIdent(table, d);
}

/** A SQL literal for a text value from the grid (null → NULL). */
export function quoteLiteral(v: string | null, d: Dialect): string {
  if (v === null) return "NULL";
  const body = v.replace(/'/g, "''");
  return d === "mysql" ? `'${body.replace(/\\/g, "\\\\")}'` : `'${body}'`;
}

export interface Statement {
  text: string;
  from: number;
  to: number;
}

/** Split a script on `;` outside strings, identifiers, comments and $tag$ blocks. */
export function splitStatements(sql: string, d: Dialect = "postgres"): Statement[] {
  const out: Statement[] = [];
  let start = 0;
  let i = 0;
  const push = (end: number) => {
    const raw = sql.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text && !/^(--[^\n]*\n?|\/\*[\s\S]*?\*\/|\s)*$/.test(text)) out.push({ text, from: start + lead, to: start + lead + text.length });
  };
  while (i < sql.length) {
    const c = sql[i];
    const n = sql[i + 1];
    if (c === "-" && n === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
    } else if (c === "#" && d === "mysql") {
      while (i < sql.length && sql[i] !== "\n") i++;
    } else if (c === "/" && n === "*") {
      const e = sql.indexOf("*/", i + 2);
      i = e < 0 ? sql.length : e + 2;
    } else if (c === "'" || c === '"' || c === "`") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "\\" && d === "mysql" && c !== "`") i += 2;
        else if (sql[i] === c && sql[i + 1] === c) i += 2;
        else if (sql[i] === c) break;
        else i++;
      }
      i++;
    } else if (c === "$" && d === "postgres") {
      const m = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i));
      if (m) {
        const e = sql.indexOf(m[0], i + m[0].length);
        i = e < 0 ? sql.length : e + m[0].length;
      } else i++;
    } else if (c === ";") {
      push(i);
      start = i + 1;
      i++;
    } else i++;
  }
  push(sql.length);
  return out;
}

/** The statement containing (or nearest before) `offset`. */
export function statementAt(sql: string, offset: number, d: Dialect = "postgres"): Statement | null {
  const all = splitStatements(sql, d);
  return all.find((s) => offset >= s.from && offset <= s.to + 1) ?? [...all].reverse().find((s) => s.to < offset) ?? all[0] ?? null;
}

export interface ColumnMeta {
  name: string;
  primaryKey: boolean;
}

export type RowEdit =
  | { kind: "update"; original: (string | null)[]; values: (string | null)[] }
  | { kind: "insert"; values: (string | null)[] }
  | { kind: "delete"; original: (string | null)[] };

function where(columns: ColumnMeta[], resultCols: string[], row: (string | null)[], d: Dialect): string {
  const keys = columns.filter((c) => c.primaryKey).map((c) => c.name);
  // Without a primary key, match on every column (and LIMIT to one row where supported).
  const use = keys.length ? keys : resultCols;
  const parts = use.map((name) => {
    const v = row[resultCols.indexOf(name)];
    return v === null || v === undefined ? `${quoteIdent(name, d)} IS NULL` : `${quoteIdent(name, d)} = ${quoteLiteral(v, d)}`;
  });
  return parts.join(" AND ");
}

/** SQL for grid edits on one table; columns are the table's, resultCols the grid's. */
export function editStatements(table: { schema: string | null; name: string }, columns: ColumnMeta[], resultCols: string[], edits: RowEdit[], d: Dialect): string[] {
  const t = qualified(table.schema, table.name, d);
  const hasPk = columns.some((c) => c.primaryKey && resultCols.includes(c.name));
  const limit = !hasPk && d === "mysql" ? " LIMIT 1" : "";
  const out: string[] = [];
  for (const e of edits) {
    if (e.kind === "update") {
      const sets = resultCols
        .map((name, i) => (e.values[i] !== e.original[i] ? `${quoteIdent(name, d)} = ${quoteLiteral(e.values[i], d)}` : null))
        .filter(Boolean);
      if (sets.length) out.push(`UPDATE ${t} SET ${sets.join(", ")} WHERE ${where(columns, resultCols, e.original, d)}${limit}`);
    } else if (e.kind === "delete") {
      out.push(`DELETE FROM ${t} WHERE ${where(columns, resultCols, e.original, d)}${limit}`);
    } else {
      // Leave unset columns to their defaults (serial ids, timestamps).
      const cols = resultCols.filter((_, i) => e.values[i] !== null && e.values[i] !== "");
      const vals = resultCols.map((_, i) => e.values[i]).filter((v) => v !== null && v !== "");
      out.push(cols.length ? `INSERT INTO ${t} (${cols.map((c) => quoteIdent(c, d)).join(", ")}) VALUES (${vals.map((v) => quoteLiteral(v, d)).join(", ")})` : d === "mysql" ? `INSERT INTO ${t} () VALUES ()` : `INSERT INTO ${t} DEFAULT VALUES`);
    }
  }
  return out;
}

/** The table a simple `SELECT … FROM t …` reads (so its results can be edited), else null. */
export function editableTable(sql: string): { schema: string | null; name: string } | null {
  const s = sql.trim().replace(/;$/, "");
  if (!/^select\b/i.test(s) || /\b(join|union|group\s+by|distinct|having|intersect|except)\b/i.test(s)) return null;
  const m = /\bfrom\s+((?:"[^"]+"|`[^`]+`|[\w$]+)(?:\.(?:"[^"]+"|`[^`]+`|[\w$]+))?)(?:\s|$)/i.exec(s);
  if (!m) return null;
  const parts = m[1].split(".").map((p) => p.replace(/^["`]|["`]$/g, ""));
  return parts.length === 2 ? { schema: parts[0], name: parts[1] } : { schema: null, name: parts[0] };
}

/** Why a statement deserves a confirmation, or null. */
export function dangerReason(sql: string): string | null {
  const s = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
  if (/^\s*(drop|truncate)\b/i.test(s)) return `${/^\s*(\w+)/.exec(s)![1].toUpperCase()} can't be undone`;
  if (/^\s*delete\s+from\b/i.test(s) && !/\bwhere\b/i.test(s)) return "DELETE without WHERE removes every row";
  if (/^\s*update\b/i.test(s) && !/\bwhere\b/i.test(s)) return "UPDATE without WHERE changes every row";
  if (/^\s*alter\s+table\b[\s\S]*\bdrop\b/i.test(s)) return "ALTER TABLE … DROP removes data";
  return null;
}

export function toCsv(columns: string[], rows: (string | null)[][]): string {
  const q = (v: string | null) => (v === null ? "" : /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return `${[columns.map(q).join(","), ...rows.map((r) => r.map(q).join(","))].join("\n")}\n`;
}

export function toJson(columns: string[], rows: (string | null)[][]): string {
  return JSON.stringify(rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]]))), null, 2);
}

/** Parse a connection URL (postgres://, mysql://, sqlite:path). */
export function parseConnectionUrl(url: string): { kind: Dialect; host?: string; port?: number; user?: string; password?: string; database?: string; path?: string; ssl?: string } | null {
  const lite = /^sqlite:(?:\/\/)?(.+)$/.exec(url.trim());
  if (lite) return { kind: "sqlite", path: decodeURIComponent(lite[1]) };
  try {
    const u = new URL(url.trim());
    const proto = u.protocol.replace(/:$/, "");
    const kind: Dialect | null = proto === "postgres" || proto === "postgresql" ? "postgres" : proto === "mysql" || proto === "mariadb" ? "mysql" : null;
    if (!kind) return null;
    const ssl = u.searchParams.get("sslmode") ?? u.searchParams.get("ssl-mode") ?? undefined;
    return {
      kind,
      host: u.hostname || undefined,
      port: u.port ? Number(u.port) : undefined,
      user: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
      database: u.pathname.replace(/^\//, "") || undefined,
      ssl: ssl ? (/^(require|verify|required)/i.test(ssl) ? "require" : /disable/i.test(ssl) ? "disable" : "prefer") : undefined,
    };
  } catch {
    return null;
  }
}
