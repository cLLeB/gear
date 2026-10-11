import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { explainSql, flatten, hotspots, parseMysqlPlan, parsePgPlan, parseSqlitePlan, planJson, safeToAnalyze } from "./plan";

const fx = (f: string) => readFileSync(join(__dirname, "__fixtures__", f), "utf8");

describe("query plans", () => {
  it("parses a real PostgreSQL EXPLAIN ANALYZE", () => {
    const plan = parsePgPlan(planJson([[fx("pg-plan.json")]]));
    expect(plan.analyzed).toBe(true);
    expect(plan.executionMs).toBeGreaterThan(0);
    const nodes = flatten(plan.root).map((x) => x.node);
    expect(plan.root.label).toBe("Sort");
    expect(nodes.some((n) => n.label.includes("Hash Join"))).toBe(true);
    const scan = nodes.find((n) => n.detail.startsWith("on plan_orders"))!;
    expect(scan.label).toBe("Seq Scan");
    expect(scan.conditions.some((c) => c.startsWith("Filter:"))).toBe(true);
    // Self times add up to the root's inclusive time.
    const selfSum = nodes.reduce((a, n) => a + (n.selfMs ?? 0), 0);
    expect(selfSum).toBeCloseTo(plan.root.totalMs!, 1);
    expect(hotspots(plan)[0].selfMs).toBeGreaterThan(0);
    expect(scan.props.some(([k]) => k === "Rows Removed by Filter")).toBe(true);
  });

  it("warns about estimates and full scans", () => {
    const p = parsePgPlan([
      {
        Plan: { "Node Type": "Seq Scan", "Relation Name": "events", Alias: "events", "Plan Rows": 10, "Actual Rows": 5000, "Actual Loops": 1, "Actual Total Time": 80, "Total Cost": 900, Filter: "(kind = 'x')", "Rows Removed by Filter": 900000 },
        "Planning Time": 0.1,
        "Execution Time": 80.5,
      },
    ]);
    expect(p.root.warnings.join("\n")).toMatch(/Full scan of events that throws away 900k rows/);
    expect(p.root.warnings.join("\n")).toMatch(/off by 500×/);
    const est = parsePgPlan(planJson([[fx("pg-plan-estimate.json")]]));
    expect(est.analyzed).toBe(false);
    expect(est.root.totalMs).toBeNull();
  });

  it("parses a real MariaDB ANALYZE FORMAT=JSON", () => {
    const plan = parseMysqlPlan(JSON.parse(fx("mariadb-analyze.json")));
    expect(plan.analyzed).toBe(true);
    const nodes = flatten(plan.root).map((x) => x.node);
    const labels = nodes.map((n) => n.label);
    expect(labels).toEqual(expect.arrayContaining(["Sort", "Temporary table", "Nested loop join", "Full table scan", "Index lookup"]));
    const lookup = nodes.find((n) => n.label === "Index lookup")!;
    expect(lookup.detail).toBe("on o using customer_id");
    expect(lookup.loops).toBe(2000);
    expect(lookup.totalMs).toBeGreaterThan(0);
    expect(lookup.conditions[0]).toMatch(/^Filter: o.created/);
    expect(nodes.find((n) => n.label === "Full table scan")!.warnings[0]).toMatch(/Full scan of c/);
    // Operations report their own time only: the sort includes its input, and the
    // query's self time is just what isn't accounted for below it.
    const sort = nodes.find((n) => n.label === "Sort")!;
    expect(sort.totalMs!).toBeGreaterThan(lookup.totalMs!);
    expect(plan.root.selfMs!).toBeLessThan(plan.root.totalMs! * 0.1);
    expect(nodes.reduce((a, n) => a + (n.selfMs ?? 0), 0)).toBeCloseTo(plan.root.totalMs!, 1);
    const est = parseMysqlPlan(JSON.parse(fx("mariadb-explain.json")));
    expect(est.analyzed).toBe(false);
    expect(flatten(est.root).some((x) => x.node.label === "Index lookup")).toBe(true);
  });

  it("parses SQLite EXPLAIN QUERY PLAN into a tree", () => {
    const { rows } = JSON.parse(fx("sqlite-plan.json")) as { rows: string[][] };
    const plan = parseSqlitePlan(rows);
    expect(plan.root.children.map((c) => c.label)).toEqual(["SEARCH", "LIST SUBQUERY", "SEARCH", "USE TEMP B-TREE", "USE TEMP B-TREE"]);
    const sub = plan.root.children[1];
    expect(sub.children[0]).toMatchObject({ label: "SCAN", detail: "orders" });
    expect(sub.children[0].warnings[0]).toMatch(/Full scan of orders/);
    expect(plan.root.children[3].warnings[0]).toMatch(/group by/);
  });

  it("builds EXPLAIN statements and refuses to ANALYZE writes", () => {
    expect(explainSql("postgres", "select 1", true, false)).toBe("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) select 1");
    expect(explainSql("mysql", "select 1", true, true)).toBe("ANALYZE FORMAT=JSON select 1");
    expect(explainSql("mysql", "select 1", true, false)).toBe("EXPLAIN FORMAT=JSON select 1");
    expect(safeToAnalyze("WITH x AS (SELECT 1) SELECT * FROM x")).toBe(true);
    expect(safeToAnalyze("select * from t where note = 'delete me'")).toBe(true);
    expect(safeToAnalyze("WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d")).toBe(false);
    expect(safeToAnalyze("update t set a = 1")).toBe(false);
  });
});
