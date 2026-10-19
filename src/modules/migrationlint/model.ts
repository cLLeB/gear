// Safety checks for PostgreSQL schema migrations: the statements that take
// locks every query waits behind, rewrite whole tables, fail on tables that
// already hold rows, or break the application version still running while
// the migration deploys — each with the lock it takes and a safer way to
// write it.

export type Severity = "danger" | "warning" | "info";

/** PostgreSQL table lock modes, weakest first. */
export const LOCKS = ["ACCESS SHARE", "ROW SHARE", "ROW EXCLUSIVE", "SHARE UPDATE EXCLUSIVE", "SHARE", "SHARE ROW EXCLUSIVE", "EXCLUSIVE", "ACCESS EXCLUSIVE"] as const;
export type Lock = (typeof LOCKS)[number];

/** What a lock mode blocks, in words. */
export const LOCK_BLOCKS: Record<Lock, string> = {
  "ACCESS SHARE": "only ACCESS EXCLUSIVE",
  "ROW SHARE": "EXCLUSIVE and ACCESS EXCLUSIVE",
  "ROW EXCLUSIVE": "schema changes and index builds",
  "SHARE UPDATE EXCLUSIVE": "other schema changes and VACUUM; reads and writes continue",
  SHARE: "all writes; reads continue",
  "SHARE ROW EXCLUSIVE": "all writes; reads continue",
  EXCLUSIVE: "all writes and SELECT … FOR UPDATE; plain reads continue",
  "ACCESS EXCLUSIVE": "every read and write",
};

export interface Statement {
  /** 1-based line where the statement starts. */
  line: number;
  /** The statement as written. */
  text: string;
  /** Comments removed, whitespace collapsed. */
  sql: string;
}

export interface Finding {
  rule: string;
  severity: Severity;
  line: number;
  message: string;
  /** A safer way to do the same thing, as SQL or advice. */
  fix: string | null;
}

export interface TableLock {
  table: string;
  lock: Lock;
  line: number;
  /** The table was created in this migration, so nothing else is using it yet. */
  isNew: boolean;
}

export interface Report {
  statements: Statement[];
  findings: Finding[];
  locks: TableLock[];
}

export interface Options {
  /** The migration tool wraps each file in a transaction (Flyway, Rails, Django, golang-migrate with `x-multi-statement`…). */
  implicitTransaction: boolean;
}

/** Splits SQL into statements, respecting quotes, dollar quoting and comments. */
export function splitStatements(text: string): Statement[] {
  const out: Statement[] = [];
  let start = 0;
  let line = 1;
  let startLine = 1;
  let i = 0;
  let clean = "";
  let seenCode = false;
  const push = (end: number) => {
    const sql = clean.replace(/\s+/g, " ").trim();
    if (sql) out.push({ line: startLine, text: text.slice(start, end).trim(), sql });
    clean = "";
    seenCode = false;
    start = end + 1;
  };
  const markCode = () => {
    if (!seenCode) {
      seenCode = true;
      startLine = line;
      start = i;
    }
  };
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "\n") {
      line++;
      clean += " ";
      i++;
      continue;
    }
    if (ch === "-" && next === "-") {
      while (i < text.length && text[i] !== "\n") i++;
      clean += " ";
      continue;
    }
    if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < text.length && depth > 0) {
        if (text[i] === "\n") line++;
        if (text[i] === "/" && text[i + 1] === "*") (depth++, (i += 2));
        else if (text[i] === "*" && text[i + 1] === "/") (depth--, (i += 2));
        else i++;
      }
      clean += " ";
      continue;
    }
    if (ch === "'" || ch === '"') {
      markCode();
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === ch && text[j + 1] === ch) j += 2;
        else if (text[j] === ch) break;
        else j++;
      }
      const lit = text.slice(i, j + 1);
      line += (lit.match(/\n/g) ?? []).length;
      clean += lit.replace(/\n/g, " ");
      i = j + 1;
      continue;
    }
    if (ch === "$") {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i));
      if (tag) {
        markCode();
        const end = text.indexOf(tag[0], i + tag[0].length);
        const stop = end < 0 ? text.length : end + tag[0].length;
        const body = text.slice(i, stop);
        line += (body.match(/\n/g) ?? []).length;
        clean += body.replace(/\n/g, " ");
        i = stop;
        continue;
      }
    }
    if (ch === ";") {
      push(i);
      i++;
      continue;
    }
    if (!/\s/.test(ch)) markCode();
    clean += ch;
    i++;
  }
  push(text.length);
  return out;
}

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)`;
const QNAME = String.raw`${IDENT}(?:\.${IDENT})?`;

/** `public."Users"` → `public.Users`, `Orders` → `orders`. */
export function normName(name: string): string {
  return name
    .split(/\.(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((p) => (p.startsWith('"') ? p.slice(1, -1).replace(/""/g, '"') : p.toLowerCase()))
    .join(".");
}

const bare = (t: string) => t.replace(/^public\./, "");

/** Splits on commas that are not inside parentheses or quotes. */
export function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  let quote: string | null = null;
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

const VOLATILE = /\b(now|clock_timestamp|statement_timestamp|transaction_timestamp|random|gen_random_uuid|uuid_generate_v[14]|timeofday|nextval)\s*\(|\bcurrent_(timestamp|date|time)\b|\blocaltimestamp\b/i;
// now() and CURRENT_TIMESTAMP are stable within a statement: PostgreSQL 11+ stores them without a rewrite.
const REWRITES_DEFAULT = /\b(clock_timestamp|random|gen_random_uuid|uuid_generate_v[14]|timeofday|nextval)\s*\(/i;

/** Whether `ALTER COLUMN … TYPE` can skip the table rewrite (binary-coercible widening). */
export function typeChangeIsCheap(to: string): boolean {
  const t = to.trim().toLowerCase();
  // Widening varchar(n) or numeric precision avoids a rewrite too, but the old type is not in the migration, so only text and unbounded varchar are trusted.
  return /^(text|varchar|character varying)$/.test(t);
}

export function lintMigration(text: string, opts: Options = { implicitTransaction: false }): Report {
  const statements = splitStatements(text);
  const findings: Finding[] = [];
  const locks: TableLock[] = [];
  const created = new Set<string>();
  let inTx = opts.implicitTransaction;
  let explicitTx = false;
  let lockTimeout = false;
  let warnedTimeout = false;
  const exclusiveInTx = new Set<string>();
  const add = (s: Statement, rule: string, severity: Severity, message: string, fix: string | null = null) => findings.push({ rule, severity, line: s.line, message, fix });
  const lock = (s: Statement, table: string, l: Lock) => {
    const t = bare(normName(table));
    locks.push({ table: t, lock: l, line: s.line, isNew: created.has(t) });
    if (l === "ACCESS EXCLUSIVE" && !created.has(t)) {
      // Once per file: the first statement that needs it is where SET lock_timeout belongs.
      if (!lockTimeout && !warnedTimeout) {
        warnedTimeout = true;
        add(s, "lock-timeout", "warning", `Takes an ACCESS EXCLUSIVE lock on ${t} with no lock_timeout set: if a long query holds the table, this waits — and every query behind it waits too.`, "SET lock_timeout = '5s';  -- before this statement, and retry the migration if it times out");
      }
      if (inTx) exclusiveInTx.add(t);
    }
  };
  const isNew = (t: string) => created.has(bare(normName(t)));

  for (const s of statements) {
    const q = s.sql;
    let m: RegExpExecArray | null;

    if (/^(BEGIN|START TRANSACTION)\b/i.test(q)) {
      inTx = true;
      explicitTx = true;
      continue;
    }
    if (/^(COMMIT|END|ROLLBACK)\b/i.test(q)) {
      inTx = opts.implicitTransaction;
      explicitTx = false;
      exclusiveInTx.clear();
      continue;
    }
    if (/^SET\s+(LOCAL\s+)?lock_timeout\b/i.test(q)) {
      lockTimeout = !/=\s*'?0'?\s*$|\bTO\s+'?0'?\s*$/i.test(q);
      continue;
    }
    if (/^SET\s+(LOCAL\s+)?statement_timeout\b/i.test(q)) {
      continue;
    }

    // CREATE TABLE
    if ((m = new RegExp(String.raw`^CREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QNAME})`, "i").exec(q))) {
      const t = bare(normName(m[1]));
      created.add(t);
      if (/\b(serial|integer|int4?)\b[^,]*\bPRIMARY\s+KEY\b/i.test(q) && !/\bbig(serial|int)\b[^,]*PRIMARY\s+KEY/i.test(q)) add(s, "int-primary-key", "info", `${t} uses a 32-bit primary key; it runs out at 2.1 billion rows and changing it later rewrites the table.`, "Use bigint (or bigserial / GENERATED ALWAYS AS IDENTITY on bigint).");
      if (/\btimestamp\b(?!\s*(\(\d+\)\s*)?with\s+time\s+zone)(?!tz)/i.test(q.replace(/timestamptz/gi, ""))) add(s, "timestamp-without-tz", "info", `${t} has a timestamp without time zone; values are stored without knowing which zone they meant.`, "Use timestamptz.");
      if (/\bvarchar\s*\(\s*\d+\s*\)|\bcharacter varying\s*\(/i.test(q)) add(s, "varchar-limit", "info", `${t} uses varchar(n); raising the limit later needs an ALTER, and text performs the same.`, "Use text, with a CHECK (char_length(col) <= n) if the limit matters.");
      continue;
    }

    // CREATE INDEX
    if ((m = new RegExp(String.raw`^CREATE\s+(UNIQUE\s+)?INDEX\s+(CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:${QNAME}\s+)?ON\s+(?:ONLY\s+)?(${QNAME})`, "i").exec(q))) {
      const table = m[3];
      if (m[2]) {
        if (inTx) add(s, "concurrently-in-transaction", "danger", "CREATE INDEX CONCURRENTLY cannot run inside a transaction block; this statement fails.", explicitTx ? "Move it outside BEGIN … COMMIT, into a migration of its own." : "Put it in a migration your tool runs without a transaction (e.g. disable_ddl_transaction! in Rails, atomic = False in Django, -- +goose NO TRANSACTION).");
        lock(s, table, "SHARE UPDATE EXCLUSIVE");
      } else if (!isNew(table)) {
        add(s, "index-not-concurrent", "danger", `Building an index on ${bare(normName(table))} without CONCURRENTLY blocks all writes to it until the build finishes — minutes on a large table.`, s.text.replace(/\bINDEX\b/i, "INDEX CONCURRENTLY") + ";  -- outside a transaction");
        lock(s, table, "SHARE");
      } else lock(s, table, "SHARE");
      continue;
    }

    // DROP INDEX
    if ((m = /^DROP\s+INDEX\s+(CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?(.+)$/i.exec(q))) {
      if (!m[1]) add(s, "drop-index-not-concurrent", "warning", "DROP INDEX without CONCURRENTLY takes an ACCESS EXCLUSIVE lock on the table.", s.text.replace(/\bINDEX\b/i, "INDEX CONCURRENTLY") + ";  -- outside a transaction");
      else if (inTx) add(s, "concurrently-in-transaction", "danger", "DROP INDEX CONCURRENTLY cannot run inside a transaction block.", "Move it into a migration that runs without a transaction.");
      continue;
    }

    // REINDEX, VACUUM FULL, CLUSTER, TRUNCATE
    if (/^REINDEX\b/i.test(q) && !/\bCONCURRENTLY\b/i.test(q)) {
      add(s, "reindex-not-concurrent", "warning", "REINDEX without CONCURRENTLY blocks writes (and reads that use the index) until it finishes.", "REINDEX … CONCURRENTLY (PostgreSQL 12+), outside a transaction.");
      continue;
    }
    if ((m = new RegExp(String.raw`^(VACUUM\s+(?:\(\s*)?FULL|CLUSTER)\b\s*\)?\s*(${QNAME})?`, "i").exec(q))) {
      add(s, "table-rewrite-lock", "danger", `${m[1].toUpperCase().startsWith("VACUUM") ? "VACUUM FULL" : "CLUSTER"} rewrites the table under an ACCESS EXCLUSIVE lock; nothing can read or write it meanwhile.`, "Use pg_repack, or plain VACUUM.");
      if (m[2]) lock(s, m[2], "ACCESS EXCLUSIVE");
      continue;
    }
    if ((m = new RegExp(String.raw`^TRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?(${QNAME})`, "i").exec(q))) {
      add(s, "truncate", "danger", `TRUNCATE deletes every row of ${bare(normName(m[1]))}.`, null);
      lock(s, m[1], "ACCESS EXCLUSIVE");
      continue;
    }

    // UPDATE / DELETE without WHERE (backfills in a schema migration)
    if ((m = new RegExp(String.raw`^(UPDATE|DELETE\s+FROM)\s+(?:ONLY\s+)?(${QNAME})`, "i").exec(q))) {
      const table = bare(normName(m[2]));
      if (!/\bWHERE\b/i.test(q)) add(s, "unbatched-write", m[1].toUpperCase() === "UPDATE" ? "warning" : "danger", `${m[1].toUpperCase().startsWith("DELETE") ? "Deletes" : "Updates"} every row of ${table} in one statement: row locks on the whole table, a long transaction and a burst of WAL.`, "Backfill in batches (e.g. WHERE id BETWEEN … in a loop) outside the schema migration.");
      else if (inTx && !isNew(table)) add(s, "write-in-migration", "info", `Data change on ${table} inside the migration transaction keeps its row locks until the migration commits.`, null);
      lock(s, m[2], "ROW EXCLUSIVE");
      continue;
    }

    // DROP TABLE / RENAME TABLE
    if ((m = new RegExp(String.raw`^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(${QNAME}(?:\s*,\s*${QNAME})*)`, "i").exec(q))) {
      for (const t of m[1].split(/\s*,\s*/)) {
        if (!isNew(t)) add(s, "drop-table", "warning", `Dropping ${bare(normName(t))}: the app version still running during the deploy may query it.`, "Stop using the table in code and deploy that first; drop it in a later migration.");
        lock(s, t, "ACCESS EXCLUSIVE");
      }
      continue;
    }

    // CREATE TRIGGER
    if ((m = new RegExp(String.raw`^CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+${IDENT}\s+.*?\bON\s+(${QNAME})`, "i").exec(q))) {
      lock(s, m[1], "SHARE ROW EXCLUSIVE");
      continue;
    }

    // ALTER TYPE … ADD VALUE
    if (/^ALTER\s+TYPE\b.*\bADD\s+VALUE\b/i.test(q)) {
      if (inTx) add(s, "enum-add-value-in-transaction", "info", "ALTER TYPE … ADD VALUE inside a transaction fails before PostgreSQL 12, and the new value cannot be used until the transaction commits.", "Add enum values in their own migration.");
      continue;
    }

    // ALTER TABLE
    if ((m = new RegExp(String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${QNAME})\s+(.*)$`, "i").exec(q))) {
      const table = m[1];
      const t = bare(normName(table));
      const fresh = isNew(table);
      let strongest: Lock = "ACCESS SHARE";
      const raise = (l: Lock) => {
        if (LOCKS.indexOf(l) > LOCKS.indexOf(strongest)) strongest = l;
      };
      const rest = m[2];
      if ((m = new RegExp(String.raw`^RENAME\s+TO\s+(${IDENT})`, "i").exec(rest))) {
        if (!fresh) add(s, "rename-table", "danger", `Renaming ${t} breaks every query of the app version still running during the deploy.`, `Create a view with the old name for the transition, or rename in code first and keep both names working.`);
        raise("ACCESS EXCLUSIVE");
        lock(s, table, strongest);
        continue;
      }
      for (const action of splitTopLevel(rest)) {
        let a: RegExpExecArray | null;
        if ((a = new RegExp(String.raw`^RENAME\s+(?:COLUMN\s+)?(${IDENT})\s+TO\s+(${IDENT})`, "i").exec(action))) {
          if (!fresh) add(s, "rename-column", "danger", `Renaming ${t}.${normName(a[1])} to ${normName(a[2])} breaks the app version still running during the deploy.`, "Add the new column, write to both, backfill, switch reads, then drop the old one in a later release.");
          raise("ACCESS EXCLUSIVE");
        } else if ((a = new RegExp(String.raw`^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?!CONSTRAINT\b|PRIMARY\b|UNIQUE\b|FOREIGN\b|CHECK\b|EXCLUDE\b)(${IDENT})\s+(.*)$`, "i").exec(action))) {
          const col = normName(a[1]);
          const def = a[2];
          raise("ACCESS EXCLUSIVE");
          if (fresh) continue;
          const notNull = /\bNOT\s+NULL\b/i.test(def);
          const dflt = /\bDEFAULT\s+(.+?)(?=\s+(?:NOT\s+NULL|NULL|CONSTRAINT|CHECK|REFERENCES|UNIQUE|PRIMARY|GENERATED|COLLATE)\b|$)/i.exec(def);
          if (/^(small|big)?serial\b/i.test(def)) add(s, "add-serial-column", "danger", `Adding serial column ${col} fills every existing row from a sequence: the whole table is rewritten under an ACCESS EXCLUSIVE lock.`, "Add a nullable bigint column, attach the sequence, backfill in batches.");
          else if (/\bGENERATED\s+ALWAYS\s+AS\s*\(.*\)\s*STORED\b/i.test(def)) add(s, "add-stored-generated", "danger", `Adding stored generated column ${col} computes it for every row: a full rewrite under an ACCESS EXCLUSIVE lock.`, "Add a plain column, backfill in batches and keep it updated with a trigger.");
          else if (dflt && REWRITES_DEFAULT.test(dflt[1])) add(s, "add-column-volatile-default", "danger", `The default for ${col} (${dflt[1].trim()}) is volatile, so every existing row is rewritten under an ACCESS EXCLUSIVE lock.`, `ALTER TABLE ${t} ADD COLUMN ${col} <type>;  then  ALTER TABLE ${t} ALTER COLUMN ${col} SET DEFAULT ${dflt[1].trim()};  and backfill in batches.`);
          else if (notNull && !dflt) add(s, "add-column-not-null", "danger", `Adding ${col} as NOT NULL without a default fails as soon as ${t} has a row.`, `Add it with a DEFAULT, or add it nullable, backfill, then add a NOT NULL check (see set-not-null).`);
          if (/\bPRIMARY\s+KEY\b|\bUNIQUE\b/i.test(def)) add(s, "add-column-unique", "danger", `The inline ${/PRIMARY/i.test(def) ? "PRIMARY KEY" : "UNIQUE"} on ${col} builds an index while holding an ACCESS EXCLUSIVE lock.`, "Add the column, build a unique index CONCURRENTLY, then ADD CONSTRAINT … USING INDEX.");
          if (/\bREFERENCES\b/i.test(def) && !notNull) raise("SHARE ROW EXCLUSIVE");
          if (dflt && VOLATILE.test(dflt[1]) && !REWRITES_DEFAULT.test(dflt[1])) add(s, "add-column-stable-default", "info", `${col} defaults to ${dflt[1].trim()}: every existing row gets the migration's timestamp, not its real creation time.`, null);
        } else if ((a = /^ADD\s+(?:CONSTRAINT\s+(\S+)\s+)?(FOREIGN\s+KEY|CHECK|UNIQUE|PRIMARY\s+KEY|EXCLUDE)\b(.*)$/i.exec(action))) {
          const kind = a[2].toUpperCase().replace(/\s+/g, " ");
          const rest2 = a[3];
          const notValid = /\bNOT\s+VALID\b/i.test(rest2);
          const usingIndex = /\bUSING\s+INDEX\b(?!\s+TABLESPACE)/i.test(rest2);
          if (kind === "FOREIGN KEY") {
            raise("SHARE ROW EXCLUSIVE");
            const ref = new RegExp(String.raw`\bREFERENCES\s+(${QNAME})`, "i").exec(rest2);
            if (ref) lock(s, ref[1], "SHARE ROW EXCLUSIVE");
            if (!notValid && !fresh) add(s, "fk-not-valid", "danger", `Adding a foreign key to ${t} checks every existing row while blocking writes to both tables.`, `${s.text.replace(/;?\s*$/, "")} NOT VALID;\nALTER TABLE ${t} VALIDATE CONSTRAINT ${a[1] ?? "<name>"};  -- in a later migration; it only blocks schema changes`);
          } else if (kind === "CHECK") {
            raise("ACCESS EXCLUSIVE");
            if (!notValid && !fresh) add(s, "check-not-valid", "danger", `Adding a CHECK constraint to ${t} scans every row while holding an ACCESS EXCLUSIVE lock.`, `${s.text.replace(/;?\s*$/, "")} NOT VALID;\nALTER TABLE ${t} VALIDATE CONSTRAINT ${a[1] ?? "<name>"};  -- in a later migration`);
          } else {
            raise("ACCESS EXCLUSIVE");
            if (!usingIndex && !fresh && kind !== "EXCLUDE") add(s, "unique-without-index", "danger", `Adding a ${kind} constraint to ${t} builds its index while holding an ACCESS EXCLUSIVE lock.`, `CREATE UNIQUE INDEX CONCURRENTLY ${a[1] ?? `${t.replace(/\W/g, "_")}_key`} ON ${t} (…);\nALTER TABLE ${t} ADD CONSTRAINT ${a[1] ?? "<name>"} ${kind} USING INDEX ${a[1] ?? `${t.replace(/\W/g, "_")}_key`};`);
          }
        } else if ((a = new RegExp(String.raw`^ALTER\s+(?:COLUMN\s+)?(${IDENT})\s+(?:SET\s+DATA\s+)?TYPE\s+(.+?)(?:\s+USING\s+.*)?$`, "i").exec(action))) {
          raise("ACCESS EXCLUSIVE");
          if (!fresh && !typeChangeIsCheap(a[2])) add(s, "change-column-type", "danger", `Changing the type of ${t}.${normName(a[1])} to ${a[2].trim()} usually rewrites the table and its indexes under an ACCESS EXCLUSIVE lock.`, "Add a new column of the new type, backfill in batches, switch the app over, then drop the old column.");
        } else if ((a = new RegExp(String.raw`^ALTER\s+(?:COLUMN\s+)?(${IDENT})\s+SET\s+NOT\s+NULL`, "i").exec(action))) {
          raise("ACCESS EXCLUSIVE");
          const col = normName(a[1]);
          if (!fresh) add(s, "set-not-null", "danger", `SET NOT NULL on ${t}.${col} scans the whole table while holding an ACCESS EXCLUSIVE lock.`, `ALTER TABLE ${t} ADD CONSTRAINT ${col}_not_null CHECK (${col} IS NOT NULL) NOT VALID;\nALTER TABLE ${t} VALIDATE CONSTRAINT ${col}_not_null;\nALTER TABLE ${t} ALTER COLUMN ${col} SET NOT NULL;  -- PostgreSQL 12+ uses the valid check and skips the scan\nALTER TABLE ${t} DROP CONSTRAINT ${col}_not_null;`);
        } else if (/^ALTER\s+(?:COLUMN\s+)?\S+\s+(SET|DROP)\s+DEFAULT\b/i.test(action) || /^ALTER\s+(?:COLUMN\s+)?\S+\s+DROP\s+NOT\s+NULL\b/i.test(action)) {
          raise("ACCESS EXCLUSIVE");
        } else if ((a = new RegExp(String.raw`^DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?(?!CONSTRAINT\b)(${IDENT})`, "i").exec(action))) {
          raise("ACCESS EXCLUSIVE");
          if (!fresh) add(s, "drop-column", "warning", `Dropping ${t}.${normName(a[1])}: the app version still running during the deploy may still read or write it (and ORMs that SELECT * break).`, "Stop using the column in code (and tell the ORM to ignore it) and deploy that first; drop it in a later migration.");
        } else if (/^VALIDATE\s+CONSTRAINT\b/i.test(action)) {
          raise("SHARE UPDATE EXCLUSIVE");
          if (inTx && exclusiveInTx.size) add(s, "validate-with-exclusive", "warning", "VALIDATE CONSTRAINT runs in the same transaction as statements that took ACCESS EXCLUSIVE locks, so those locks are held for the whole validation scan.", "Run VALIDATE in its own migration.");
        } else if (/^SET\s+(LOGGED|UNLOGGED|TABLESPACE)\b/i.test(action)) {
          raise("ACCESS EXCLUSIVE");
          if (!fresh) add(s, "table-rewrite-lock", "danger", `${action.split(/\s+/).slice(0, 2).join(" ").toUpperCase()} rewrites ${t} under an ACCESS EXCLUSIVE lock.`, null);
        } else if (/^(ENABLE|DISABLE)\s+(ROW\s+LEVEL\s+SECURITY|TRIGGER)\b/i.test(action) || /^DROP\s+CONSTRAINT\b/i.test(action) || /^(OWNER|REPLICA|CLUSTER|INHERIT|NO\s+INHERIT)\b/i.test(action)) {
          raise(/^(ENABLE|DISABLE)\s+TRIGGER/i.test(action) ? "SHARE ROW EXCLUSIVE" : "ACCESS EXCLUSIVE");
        } else if (/^(ATTACH|DETACH)\s+PARTITION\b/i.test(action)) {
          raise(/CONCURRENTLY/i.test(action) || /^ATTACH/i.test(action) ? "SHARE UPDATE EXCLUSIVE" : "ACCESS EXCLUSIVE");
        } else raise("ACCESS EXCLUSIVE");
      }
      lock(s, table, strongest);
      continue;
    }
  }

  // Several tables under ACCESS EXCLUSIVE in one transaction hold all their locks until commit.
  if (opts.implicitTransaction || /\bBEGIN\b|\bSTART\s+TRANSACTION\b/i.test(text)) {
    const tables = [...new Set(locks.filter((l) => l.lock === "ACCESS EXCLUSIVE" && !l.isNew).map((l) => l.table))];
    if (tables.length > 1) findings.push({ rule: "many-exclusive-locks", severity: "warning", line: locks.find((l) => l.lock === "ACCESS EXCLUSIVE" && !l.isNew)?.line ?? 1, message: `One transaction takes ACCESS EXCLUSIVE locks on ${tables.length} tables (${tables.join(", ")}) and holds them all until it commits; lock ordering against the app can deadlock.`, fix: "Split the migration so each transaction locks one table." });
  }
  findings.sort((a, b) => a.line - b.line);
  return { statements, findings, locks };
}

/** The strongest lock per table, for a summary. */
export function lockSummary(locks: TableLock[]): TableLock[] {
  const m = new Map<string, TableLock>();
  for (const l of locks) {
    const cur = m.get(l.table);
    if (!cur || LOCKS.indexOf(l.lock) > LOCKS.indexOf(cur.lock)) m.set(l.table, l);
  }
  return [...m.values()].sort((a, b) => LOCKS.indexOf(b.lock) - LOCKS.indexOf(a.lock) || a.table.localeCompare(b.table));
}

/** Where migration files usually live (Prisma, Supabase, Flyway, golang-migrate, dbmate, sqlx, Drizzle, Knex/raw SQL). */
export const MIGRATION_PATH = /(^|\/)(migrations?|migrate|db\/migrate|schema|sql|flyway|liquibase|changelog|supabase\/migrations|prisma\/migrations|drizzle)(\/|$)|(^|\/)V\d+(_\d+)*__[^/]+\.sql$|\.up\.sql$/i;
