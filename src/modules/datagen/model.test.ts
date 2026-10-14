import { describe, expect, it } from "vitest";
import { generate, guessType, order, rngFrom, tableFromJson, tablesFromSql, toCsv, toJson, toNdjson, toSql, valueFor, type Table } from "./model";

const users: Table = {
  name: "users",
  rows: 20,
  columns: [
    { name: "id", type: "id" },
    { name: "name", type: "fullName" },
    { name: "email", type: "email", unique: true },
    { name: "role", type: "enum", values: ["admin:1", "member:9"] },
    { name: "active", type: "bool", trueRatio: 0.8 },
    { name: "nickname", type: "words", nullRatio: 0.5 },
  ],
};
const orders: Table = {
  name: "orders",
  rows: 50,
  columns: [
    { name: "id", type: "uuid", unique: true },
    { name: "user_id", type: "ref", ref: "users.id" },
    { name: "total", type: "price", min: 5, max: 50 },
    { name: "code", type: "pattern", pattern: "ORD-AA-####" },
    { name: "placed", type: "date", min: "2025-01-01", max: "2025-12-31" },
  ],
};

describe("dataset generator", () => {
  it("is repeatable for a seed", () => {
    const a = rngFrom(42);
    const b = rngFrom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(rngFrom(1)()).not.toBe(rngFrom(2)());
    expect(toJson(generate([users], 7).tables.get("users") ?? [])).toBe(toJson(generate([users], 7).tables.get("users") ?? []));
  });

  it("fills columns as configured", () => {
    const { tables, warnings } = generate([orders, users], 3);
    expect(warnings).toEqual([]);
    const u = tables.get("users") ?? [];
    const o = tables.get("orders") ?? [];
    expect([...tables.keys()]).toEqual(["orders", "users"]);
    expect(u).toHaveLength(20);
    expect(u.map((r) => r.id)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(new Set(u.map((r) => r.email)).size).toBe(20);
    for (const r of u) {
      expect(r.name).toMatch(/^[A-Z][a-z]+ [A-Z][\w-]+$/);
      expect(String(r.email)).toContain(String(r.name).toLowerCase().split(" ")[0]);
      expect(["admin", "member"]).toContain(r.role);
      expect(typeof r.active).toBe("boolean");
    }
    expect(u.filter((r) => r.nickname === null).length).toBeGreaterThan(3);
    const ids = new Set(u.map((r) => r.id));
    for (const r of o) {
      expect(ids.has(r.user_id as number)).toBe(true);
      expect(r.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(Number(r.total)).toBeGreaterThanOrEqual(5);
      expect(Number(r.total)).toBeLessThanOrEqual(50);
      expect(r.code).toMatch(/^ORD-[A-Z]{2}-\d{4}$/);
      expect(String(r.placed) >= "2025-01-01" && String(r.placed) <= "2025-12-31").toBe(true);
    }
  });

  it("orders tables by their references and catches loops", () => {
    expect(order([orders, users]).order.map((t) => t.name)).toEqual(["users", "orders"]);
    const a: Table = { name: "a", rows: 1, columns: [{ name: "b_id", type: "ref", ref: "b.id" }] };
    const b: Table = { name: "b", rows: 1, columns: [{ name: "a_id", type: "ref", ref: "a.id" }] };
    expect(order([a, b]).error).toMatch(/loop: a → b → a/);
    expect(generate([{ name: "x", rows: 2, columns: [{ name: "y", type: "ref", ref: "missing.id" }] }], 1).warnings[0]).toMatch(/no rows to point at/);
  });

  it("warns when unique values run out", () => {
    const { warnings, tables } = generate([{ name: "t", rows: 30, columns: [{ name: "flag", type: "bool", unique: true }] }], 1);
    expect(warnings[0]).toMatch(/ran out of unique values after 2 rows/);
    expect(tables.get("t")).toHaveLength(30);
  });

  it("writes JSON, NDJSON, CSV and SQL", () => {
    const rows = [
      { id: 1, name: "O'Neil, Ada", active: true, note: null },
      { id: 2, name: 'Say "hi"', active: false, note: "a\\b" },
    ];
    expect(toNdjson(rows).split("\n")).toHaveLength(2);
    expect(toCsv(rows, ["id", "name", "active", "note"])).toBe('id,name,active,note\n1,"O\'Neil, Ada",true,\n2,"Say ""hi""",false,a\\b');
    const t: Table = { name: "people", rows: 2, columns: [{ name: "id", type: "id" }, { name: "name", type: "fullName" }, { name: "active", type: "bool" }, { name: "note", type: "words", nullRatio: 0.2 }] };
    const pg = toSql(t, rows, "postgres");
    expect(pg).toContain('CREATE TABLE "people" (\n  "id" integer PRIMARY KEY,\n  "name" text NOT NULL,\n  "active" boolean NOT NULL,\n  "note" text\n);');
    expect(pg).toContain(`(1, 'O''Neil, Ada', TRUE, NULL)`);
    const my = toSql(t, rows, "mysql", false);
    expect(my.startsWith("INSERT INTO `people` (`id`, `name`, `active`, `note`) VALUES")).toBe(true);
    expect(my).toContain(`(2, 'Say "hi"', 0, 'a\\\\b')`);
    expect(toSql(orders, [], "sqlite")).toContain('"user_id" integer REFERENCES "users"("id")');
  });

  it("guesses columns from names and samples", () => {
    expect(guessType("email", "a@b.c").type).toBe("email");
    expect(guessType("user_id", 3)).toMatchObject({ type: "ref", ref: "users.id" });
    expect(guessType("created_at", "2025-01-01T00:00:00Z").type).toBe("datetime");
    expect(guessType("is_admin", false).type).toBe("bool");
    expect(guessType("status", "open")).toMatchObject({ type: "enum", values: ["open", "other"] });
    expect(guessType("score", 7)).toMatchObject({ type: "int", max: 100 });
    expect(guessType("ratio", 0.4)).toMatchObject({ type: "float" });
    expect(guessType("id", "8a3f2c1e-0000-4000-8000-000000000000").type).toBe("uuid");
  });

  it("builds tables from a JSON sample and from CREATE TABLE", () => {
    const t = tableFromJson('[{"id":1,"email":"a@b.c","price":9.5,"bio":null},{"id":2,"email":"c@d.e","price":3,"bio":"x"}]', "customers");
    expect(t.columns.map((c) => [c.name, c.type, c.nullRatio ?? 0])).toEqual([
      ["id", "id", 0],
      ["email", "email", 0],
      ["price", "price", 0],
      ["bio", "paragraph", 0.1],
    ]);
    expect(() => tableFromJson("[1,2]")).toThrow(/array of objects/);
    const sql = `
      CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(200) NOT NULL UNIQUE, age INT, joined TIMESTAMP NOT NULL);
      -- orders
      CREATE TABLE IF NOT EXISTS "orders" (
        id bigint primary key,
        buyer integer NOT NULL,
        amount numeric(10, 2) NOT NULL,
        CONSTRAINT fk_buyer FOREIGN KEY (buyer) REFERENCES users(id)
      );`;
    const ts = tablesFromSql(sql);
    expect(ts.map((x) => x.name)).toEqual(["users", "orders"]);
    expect(ts[0].columns.map((c) => [c.name, c.type, Boolean(c.unique)])).toEqual([
      ["id", "id", false],
      ["email", "email", true],
      ["age", "int", false],
      ["joined", "datetime", false],
    ]);
    expect(ts[1].columns.map((c) => [c.name, c.type, c.ref ?? ""])).toEqual([
      ["id", "id", ""],
      ["buyer", "ref", "users.id"],
      ["amount", "price", ""],
    ]);
  });

  it("makes values of every type", () => {
    const rng = rngFrom(9);
    for (const type of ["phone", "company", "street", "city", "country", "zip", "url", "ipv4", "color", "username", "sentence", "paragraph", "datetime"] as const) {
      expect(valueFor({ name: "x", type }, rng, 0, {}), type).toBeTruthy();
    }
    expect(valueFor({ name: "x", type: "ipv4" }, rng, 0, {})).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(valueFor({ name: "x", type: "color" }, rng, 0, {})).toMatch(/^#[0-9a-f]{6}$/);
    expect(valueFor({ name: "x", type: "pattern", pattern: "\\#A" }, rng, 0, {})).toMatch(/^#[A-Z]$/);
  });
});
