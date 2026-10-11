import { describe, expect, it } from "vitest";
import { dangerReason, editableTable, editStatements, parseConnectionUrl, quoteLiteral, splitStatements, statementAt, toCsv } from "./model";

describe("statements", () => {
  it("splits around strings, comments and dollar quotes", () => {
    const sql = `select 'a;b'; -- c;d
select "x;y" from t;
/* ; */ create function f() returns int as $body$ begin return 1; end $body$ language plpgsql;
  select 1`;
    expect(splitStatements(sql).map((s) => s.text)).toEqual([
      "select 'a;b'",
      `-- c;d\nselect "x;y" from t`,
      "/* ; */ create function f() returns int as $body$ begin return 1; end $body$ language plpgsql",
      "select 1",
    ]);
    expect(splitStatements("select 'it''s;'; select `a;b` # x;y\n;", "mysql").map((s) => s.text)).toEqual(["select 'it''s;'", "select `a;b` # x;y"]);
    expect(splitStatements("-- only a comment;\n")).toEqual([]);
  });

  it("finds the statement at the cursor", () => {
    const sql = "select 1;\n\nselect 2;\nselect 3";
    expect(statementAt(sql, 1)?.text).toBe("select 1");
    expect(statementAt(sql, 13)?.text).toBe("select 2");
    expect(statementAt(sql, sql.length)?.text).toBe("select 3");
  });
});

describe("edits", () => {
  const cols = [
    { name: "id", primaryKey: true },
    { name: "name", primaryKey: false },
    { name: "note", primaryKey: false },
  ];
  it("generates UPDATE / INSERT / DELETE by primary key", () => {
    const out = editStatements({ schema: "public", name: "users" }, cols, ["id", "name", "note"], [
      { kind: "update", original: ["1", "ada", null], values: ["1", "Ada O'Neil", null] },
      { kind: "insert", values: [null, "new", ""] },
      { kind: "delete", original: ["2", "bob", "x"] },
      { kind: "update", original: ["3", "c", "d"], values: ["3", "c", "d"] },
    ], "postgres");
    expect(out).toEqual([
      `UPDATE "public"."users" SET "name" = 'Ada O''Neil' WHERE "id" = '1'`,
      `INSERT INTO "public"."users" ("name") VALUES ('new')`,
      `DELETE FROM "public"."users" WHERE "id" = '2'`,
    ]);
  });

  it("falls back to all columns without a key", () => {
    expect(editStatements({ schema: null, name: "log" }, [{ name: "a", primaryKey: false }, { name: "b", primaryKey: false }], ["a", "b"], [{ kind: "delete", original: ["x", null] }], "mysql")).toEqual(["DELETE FROM `log` WHERE `a` = 'x' AND `b` IS NULL LIMIT 1"]);
    expect(quoteLiteral("a\\b'c", "mysql")).toBe("'a\\\\b''c'");
  });

  it("knows which queries are editable", () => {
    expect(editableTable("SELECT * FROM public.users WHERE id > 3 LIMIT 10")).toEqual({ schema: "public", name: "users" });
    expect(editableTable('select id, name from "Order Items"')).toEqual({ schema: null, name: "Order Items" });
    expect(editableTable("select * from a join b on a.id = b.id")).toBeNull();
    expect(editableTable("select count(*) from t group by x")).toBeNull();
  });
});

describe("safety and formats", () => {
  it("flags destructive statements", () => {
    expect(dangerReason("delete from users")).toMatch(/every row/);
    expect(dangerReason("DELETE FROM users WHERE id = 1")).toBeNull();
    expect(dangerReason("-- cleanup\nDROP TABLE x")).toMatch(/DROP/);
    expect(dangerReason("update t set a = 1")).toMatch(/UPDATE/);
  });

  it("exports CSV and parses URLs", () => {
    expect(toCsv(["a", "b"], [["1", null], ['x,"y"', "z"]])).toBe('a,b\n1,\n"x,""y""",z\n');
    expect(parseConnectionUrl("postgresql://me:p%40ss@db.example.com:6543/app?sslmode=require")).toEqual({ kind: "postgres", host: "db.example.com", port: 6543, user: "me", password: "p@ss", database: "app", ssl: "require" });
    expect(parseConnectionUrl("sqlite:///home/me/app.db")).toEqual({ kind: "sqlite", path: "/home/me/app.db" });
    expect(parseConnectionUrl("mongodb://x")).toBeNull();
  });
});
