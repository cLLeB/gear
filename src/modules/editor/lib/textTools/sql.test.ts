import { describe, expect, it } from "vitest";
import { formatSql, tokenizeSql } from "./sql";

describe("formatSql", () => {
  it("formats a typical query", () => {
    const sql = "select u.id, u.name, count(o.id) as orders from users u left join orders o on o.user_id = u.id and o.status = 'paid' where u.active = true and u.created_at between '2024-01-01' and '2024-12-31' group by u.id, u.name order by orders desc limit 10";
    expect(formatSql(sql)).toBe(
      [
        "SELECT",
        "  u.id,",
        "  u.name,",
        "  count(o.id) AS orders",
        "FROM users u",
        "LEFT JOIN orders o",
        "  ON o.user_id = u.id",
        "  AND o.status = 'paid'",
        "WHERE u.active = TRUE",
        "  AND u.created_at BETWEEN '2024-01-01' AND '2024-12-31'",
        "GROUP BY",
        "  u.id,",
        "  u.name",
        "ORDER BY",
        "  orders DESC",
        "LIMIT 10",
      ].join("\n"),
    );
  });

  it("indents subqueries and keeps strings and comments intact", () => {
    const sql = "select * from (select id from t where name = 'select, from' -- keep me\n) x where id in (1, 2)";
    expect(formatSql(sql)).toBe(
      [
        "SELECT",
        "  *",
        "FROM (",
        "  SELECT",
        "    id",
        "  FROM t",
        "  WHERE name = 'select, from' -- keep me",
        ") x",
        "WHERE id IN (1, 2)",
      ].join("\n"),
    );
  });

  it("separates statements and handles CASE", () => {
    const out = formatSql("select case when a > 1 then 'x' else 'y' end as c from t; update t set a = 1, b = 2 where id = 3;");
    expect(out).toContain("CASE\n    WHEN a > 1 THEN 'x'\n    ELSE 'y' END AS c");
    expect(out).toContain("UPDATE t\nSET\n  a = 1,\n  b = 2\nWHERE id = 3;");
  });

  it("can keep keyword case", () => {
    expect(formatSql("select 1", { uppercase: false })).toBe("select\n  1");
  });
});

describe("tokenizeSql", () => {
  it("treats quoted identifiers, dollar bodies and casts as units", () => {
    const toks = tokenizeSql(`select "Weird Col", $$ body; $$, x::int`).filter((t) => t.type !== "space").map((t) => t.text);
    expect(toks).toEqual(["select", '"Weird Col"', ",", "$$ body; $$", ",", "x", "::", "int"]);
  });
});
