import { describe, expect, it } from "vitest";
import { lintMigration, lockSummary, MIGRATION_PATH, normName, splitStatements, splitTopLevel } from "./model";

const rules = (sql: string, implicitTransaction = false) => lintMigration(sql, { implicitTransaction }).findings.map((f) => `${f.line}:${f.rule}`);

describe("migration linter", () => {
  it("splits statements around quotes, dollar quoting and comments", () => {
    const s = splitStatements(["-- header; not a statement", "CREATE TABLE a (x text DEFAULT 'a;b');", "/* block ; */", "CREATE FUNCTION f() RETURNS void AS $$", "BEGIN PERFORM 1; END;", "$$ LANGUAGE plpgsql;", "", "SELECT \"we;ird\" FROM a"].join("\n"));
    expect(s.map((x) => [x.line, x.sql.slice(0, 22)])).toEqual([
      [2, "CREATE TABLE a (x text"],
      [4, "CREATE FUNCTION f() RE"],
      [8, 'SELECT "we;ird" FROM a'],
    ]);
    expect(splitTopLevel("ADD COLUMN a numeric(10,2), DROP COLUMN b")).toEqual(["ADD COLUMN a numeric(10,2)", "DROP COLUMN b"]);
    expect(normName('public."Users"')).toBe("public.Users");
    expect(normName("Orders")).toBe("orders");
  });

  it("flags index builds and knows CONCURRENTLY cannot run in a transaction", () => {
    expect(rules("CREATE INDEX idx ON users (email);")).toEqual(["1:index-not-concurrent"]);
    expect(rules("CREATE INDEX CONCURRENTLY idx ON users (email);")).toEqual([]);
    expect(rules("BEGIN;\nCREATE INDEX CONCURRENTLY idx ON users (email);\nCOMMIT;")).toEqual(["2:concurrently-in-transaction"]);
    expect(rules("CREATE INDEX CONCURRENTLY idx ON users (email);", true)).toEqual(["1:concurrently-in-transaction"]);
    const fix = lintMigration("CREATE UNIQUE INDEX idx ON users (email);").findings[0].fix;
    expect(fix).toBe("CREATE UNIQUE INDEX CONCURRENTLY idx ON users (email);  -- outside a transaction");
    expect(rules("DROP INDEX idx;")).toEqual(["1:drop-index-not-concurrent"]);
  });

  it("ignores tables created in the same migration", () => {
    expect(rules(["CREATE TABLE orders (id bigint PRIMARY KEY, user_id bigint);", "CREATE INDEX ON orders (user_id);", "ALTER TABLE orders ADD COLUMN total numeric NOT NULL;", "ALTER TABLE orders ADD CONSTRAINT fk FOREIGN KEY (user_id) REFERENCES users (id);"].join("\n"))).toEqual([]);
  });

  it("checks added columns", () => {
    expect(rules("SET lock_timeout = '5s'; ALTER TABLE users ADD COLUMN age int NOT NULL;")).toEqual(["1:add-column-not-null"]);
    expect(rules("SET lock_timeout = '5s'; ALTER TABLE users ADD COLUMN age int NOT NULL DEFAULT 0;")).toEqual([]);
    expect(rules("SET lock_timeout = '5s'; ALTER TABLE users ADD COLUMN token uuid DEFAULT gen_random_uuid();")).toEqual(["1:add-column-volatile-default"]);
    expect(rules("SET lock_timeout = '5s'; ALTER TABLE users ADD COLUMN seen timestamptz DEFAULT now();")).toEqual(["1:add-column-stable-default"]);
    expect(rules("SET lock_timeout = '5s'; ALTER TABLE users ADD COLUMN n bigserial;")).toEqual(["1:add-serial-column"]);
    expect(rules("SET lock_timeout = '5s'; ALTER TABLE users ADD COLUMN slug text UNIQUE;")).toEqual(["1:add-column-unique"]);
  });

  it("checks constraints, type changes, NOT NULL, drops and renames", () => {
    const sql = [
      "SET lock_timeout = '3s';",
      "ALTER TABLE orders ADD CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES users (id);",
      "ALTER TABLE orders ADD CONSTRAINT orders_user_fk2 FOREIGN KEY (user_id) REFERENCES users (id) NOT VALID;",
      "ALTER TABLE orders VALIDATE CONSTRAINT orders_user_fk2;",
      "ALTER TABLE orders ADD CONSTRAINT positive CHECK (total > 0);",
      "ALTER TABLE orders ADD CONSTRAINT orders_code_key UNIQUE (code);",
      "ALTER TABLE orders ADD CONSTRAINT orders_code_key2 UNIQUE USING INDEX idx;",
      "ALTER TABLE orders ALTER COLUMN total TYPE bigint;",
      "ALTER TABLE orders ALTER COLUMN note TYPE text;",
      "ALTER TABLE orders ALTER COLUMN total SET NOT NULL;",
      "ALTER TABLE orders DROP COLUMN legacy, RENAME COLUMN a TO b;",
      "ALTER TABLE orders RENAME TO purchases;",
    ].join("\n");
    expect(rules(sql)).toEqual(["2:fk-not-valid", "5:check-not-valid", "6:unique-without-index", "8:change-column-type", "10:set-not-null", "11:drop-column", "11:rename-column", "12:rename-table"]);
    const fk = lintMigration(sql).findings[0].fix as string;
    expect(fk).toContain("REFERENCES users (id) NOT VALID;");
    expect(fk).toContain("VALIDATE CONSTRAINT orders_user_fk;");
  });

  it("asks for a lock timeout and reports the locks taken", () => {
    const r = lintMigration("ALTER TABLE users ALTER COLUMN name SET DEFAULT 'x';\nCREATE INDEX CONCURRENTLY i ON posts (a);\nALTER TABLE orders ADD CONSTRAINT fk FOREIGN KEY (u) REFERENCES users (id) NOT VALID;");
    expect(r.findings.map((f) => f.rule)).toEqual(["lock-timeout"]);
    expect(lockSummary(r.locks).map((l) => `${l.table}:${l.lock}`)).toEqual(["users:ACCESS EXCLUSIVE", "orders:SHARE ROW EXCLUSIVE", "posts:SHARE UPDATE EXCLUSIVE"]);
    expect(rules("SET lock_timeout = 0; ALTER TABLE users DROP CONSTRAINT x;")).toEqual(["1:lock-timeout"]);
  });

  it("flags long locks across several tables in one transaction", () => {
    expect(rules("SET lock_timeout='2s';\nBEGIN;\nALTER TABLE a ALTER COLUMN x SET DEFAULT 1;\nALTER TABLE b ALTER COLUMN y SET DEFAULT 2;\nCOMMIT;")).toEqual(["3:many-exclusive-locks"]);
    expect(rules("SET lock_timeout='2s';\nBEGIN;\nALTER TABLE a ALTER COLUMN x SET DEFAULT 1;\nALTER TABLE a VALIDATE CONSTRAINT c;\nCOMMIT;")).toEqual(["4:validate-with-exclusive"]);
  });

  it("flags data-destroying and table-rewriting statements", () => {
    expect(rules("TRUNCATE users;\nDELETE FROM sessions;\nUPDATE users SET a = 1;\nUPDATE users SET a = 1 WHERE id < 100;\nVACUUM FULL users;\nREINDEX TABLE users;")).toEqual([
      "1:truncate",
      "1:lock-timeout",
      "2:unbatched-write",
      "3:unbatched-write",
      "5:table-rewrite-lock",
      "6:reindex-not-concurrent",
    ]);
  });

  it("gives schema advice on new tables", () => {
    expect(rules("CREATE TABLE t (id serial PRIMARY KEY, at timestamp, name varchar(50));")).toEqual(["1:int-primary-key", "1:timestamp-without-tz", "1:varchar-limit"]);
    expect(rules("CREATE TABLE t (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, at timestamptz, name text);")).toEqual([]);
  });

  it("recognises migration folders", () => {
    for (const p of ["db/migrations/001_init.sql", "prisma/migrations/2024_x/migration.sql", "supabase/migrations/1_a.sql", "sql/V2__add_users.sql", "000001_init.up.sql"]) expect(MIGRATION_PATH.test(p)).toBe(true);
    expect(MIGRATION_PATH.test("src/queries/report.sql")).toBe(false);
  });
});
