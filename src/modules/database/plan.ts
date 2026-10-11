// Query plans from all three engines in one shape: PostgreSQL EXPLAIN
// (FORMAT JSON, optionally ANALYZE / BUFFERS), MySQL / MariaDB EXPLAIN /
// ANALYZE FORMAT=JSON, and SQLite EXPLAIN QUERY PLAN — with self / total time,
// estimated vs actual rows, and warnings for the usual problems.

export interface PlanNode {
  id: number;
  label: string;
  /** Table / index / join type, one line. */
  detail: string;
  conditions: string[];
  estRows: number | null;
  actualRows: number | null;
  loops: number;
  cost: number | null;
  /** Inclusive time over all loops (ms). */
  totalMs: number | null;
  /** Time in this node only (ms). */
  selfMs: number | null;
  warnings: string[];
  props: [string, string][];
  children: PlanNode[];
}

export interface Plan {
  root: PlanNode;
  analyzed: boolean;
  planningMs: number | null;
  executionMs: number | null;
}

let seq = 0;
const node = (label: string, extra: Partial<PlanNode> = {}): PlanNode => ({ id: ++seq, label, detail: "", conditions: [], estRows: null, actualRows: null, loops: 1, cost: null, totalMs: null, selfMs: null, warnings: [], props: [], children: [], ...extra });

/** Text-column EXPLAIN output → the JSON value (Postgres returns one row, MariaDB one cell). */
export function planJson(rows: (string | null)[][]): unknown {
  const text = rows.map((r) => r[0] ?? "").join("\n").trim();
  return JSON.parse(text);
}

function fmtRows(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : String(Math.round(n));
}

/** Shared after-pass: self time, estimate warnings. */
function finish(root: PlanNode): void {
  const walk = (n: PlanNode) => {
    n.children.forEach(walk);
    if (n.totalMs !== null) n.selfMs = Math.max(0, n.totalMs - n.children.reduce((a, c) => a + (c.totalMs ?? 0), 0));
    if (n.estRows !== null && n.actualRows !== null) {
      const est = Math.max(1, n.estRows);
      const act = Math.max(1, n.actualRows);
      const ratio = Math.max(est / act, act / est);
      if (ratio >= 10 && Math.max(n.estRows, n.actualRows) >= 100) n.warnings.push(`Row estimate off by ${Math.round(ratio)}× (${fmtRows(n.estRows)} expected, ${fmtRows(n.actualRows)} actual) — statistics may be stale (ANALYZE)`);
    }
  };
  walk(root);
}

// ── PostgreSQL ────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

const PG_SKIP = new Set(["Plans", "Node Type", "Parallel Aware", "Async Capable"]);

function pgNode(p: Obj): PlanNode {
  const type = str(p["Node Type"]) ?? "?";
  const join = str(p["Join Type"]);
  const rel = str(p["Relation Name"]);
  const alias = str(p["Alias"]);
  const index = str(p["Index Name"]);
  const label = `${join && join !== "Inner" && type.includes("Join") ? `${join} ` : ""}${type}${p["Parallel Aware"] ? " (parallel)" : ""}`;
  const detail = [rel ? `on ${rel}${alias && alias !== rel ? ` ${alias}` : ""}` : null, index ? `using ${index}` : null, str(p["CTE Name"]) ? `CTE ${p["CTE Name"]}` : null, str(p["Strategy"]) && type === "Aggregate" ? String(p["Strategy"]).toLowerCase() : null].filter(Boolean).join(" ");
  const conditions = ["Hash Cond", "Merge Cond", "Join Filter", "Index Cond", "Recheck Cond", "Filter", "Sort Key", "Group Key"].flatMap((k) => {
    const v = p[k];
    return v ? [`${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`] : [];
  });
  const loops = num(p["Actual Loops"]) ?? 1;
  const actualTotal = num(p["Actual Total Time"]);
  const n = node(label, {
    detail,
    conditions,
    estRows: num(p["Plan Rows"]),
    actualRows: num(p["Actual Rows"]) !== null ? (num(p["Actual Rows"]) as number) * loops : null,
    loops,
    cost: num(p["Total Cost"]),
    totalMs: actualTotal !== null ? actualTotal * loops : null,
    props: Object.entries(p)
      .filter(([k]) => !PG_SKIP.has(k))
      .map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)]),
    children: ((p["Plans"] as Obj[] | undefined) ?? []).map(pgNode),
  });
  // Estimates are per loop.
  if (n.estRows !== null) n.estRows *= loops;
  const removed = num(p["Rows Removed by Filter"]);
  if (type === "Seq Scan" && removed !== null && removed * loops >= 10_000 && removed > (num(p["Actual Rows"]) ?? 0) * 4) n.warnings.push(`Full scan of ${rel} that throws away ${fmtRows(removed * loops)} rows — an index on the filtered column(s) could help`);
  else if (type === "Seq Scan" && n.actualRows === null && (n.estRows ?? 0) >= 100_000) n.warnings.push(`Full scan of ${rel} (~${fmtRows(n.estRows ?? 0)} rows)`);
  if (p["Sort Space Type"] === "Disk") n.warnings.push(`Sort spilled to disk (${p["Sort Space Used"]} kB) — raise work_mem or sort less`);
  if ((num(p["Hash Batches"]) ?? 1) > 1) n.warnings.push(`Hash used ${p["Hash Batches"]} batches (spilled to disk) — raise work_mem`);
  if (type === "Nested Loop" && n.children[1] && n.children[1].loops >= 10_000) n.warnings.push(`Inner side runs ${fmtRows(n.children[1].loops)} times`);
  if ((num(p["Heap Fetches"]) ?? 0) > 10_000) n.warnings.push(`${fmtRows(num(p["Heap Fetches"]) ?? 0)} heap fetches in an index-only scan — VACUUM to update the visibility map`);
  return n;
}

export function parsePgPlan(json: unknown): Plan {
  const top = (Array.isArray(json) ? json[0] : json) as Obj;
  const root = pgNode(top["Plan"] as Obj);
  finish(root);
  return { root, analyzed: root.totalMs !== null, planningMs: num(top["Planning Time"]), executionMs: num(top["Execution Time"]) };
}

// ── MySQL / MariaDB ───────────────────────────────────────────────────────

const OPS: Record<string, string> = {
  filesort: "Sort",
  ordering_operation: "Order",
  grouping_operation: "Group",
  temporary_table: "Temporary table",
  duplicates_removal: "Remove duplicates",
  materialized_from_subquery: "Materialize subquery",
  "read_sorted_file": "Read sorted file",
  having_condition: "Having",
  union_result: "Union",
  window_functions_computation: "Window functions",
};

const ACCESS: Record<string, string> = { ALL: "Full table scan", index: "Full index scan", range: "Index range scan", ref: "Index lookup", eq_ref: "Unique index lookup", const: "Constant lookup", system: "Single row", ref_or_null: "Index lookup (or NULL)", index_merge: "Index merge", fulltext: "Fulltext search", hash: "Hash join" };

function myTable(t: Obj): PlanNode {
  const access = str(t["access_type"]) ?? "?";
  const loops = num(t["r_loops"]) ?? 1;
  const estPer = num(t["rows"]) ?? num(t["rows_examined_per_scan"]);
  const rPer = num(t["r_rows"]);
  const ms = (num(t["r_table_time_ms"]) ?? 0) + (num(t["r_other_time_ms"]) ?? 0);
  const analyzed = num(t["r_loops"]) !== null;
  const n = node(ACCESS[access] ?? access, {
    detail: [`on ${t["table_name"]}`, t["key"] ? `using ${t["key"]}` : null].filter(Boolean).join(" "),
    conditions: [t["attached_condition"] ? `Filter: ${t["attached_condition"]}` : null, Array.isArray(t["ref"]) ? `Ref: ${(t["ref"] as string[]).join(", ")}` : null].filter((x): x is string => !!x),
    estRows: estPer !== null ? estPer * (analyzed ? loops : 1) : null,
    // Rows read; r_filtered is the share that passes the attached condition.
    actualRows: rPer !== null ? rPer * loops : null,
    loops,
    cost: num((t["cost_info"] as Obj | undefined)?.["prefix_cost"]) ?? num(t["cost"]),
    totalMs: analyzed ? ms : null,
    props: Object.entries(t).filter(([, v]) => typeof v !== "object" || Array.isArray(v)).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)]),
  });
  if (access === "ALL" && (rPer ?? estPer ?? 0) * loops >= 1000) n.warnings.push(`Full scan of ${t["table_name"]} (${fmtRows((rPer ?? estPer ?? 0) * loops)} rows read)`);
  const rf = num(t["r_filtered"]);
  if (rf !== null && rf < 10 && (rPer ?? 0) * loops >= 1000) n.warnings.push(`Only ${rf.toFixed(1)}% of rows read pass the filter — an index on the filtered column(s) could help`);
  if (loops >= 10_000) n.warnings.push(`Looked up ${fmtRows(loops)} times`);
  return n;
}

function myWalk(o: Obj, label: string): PlanNode {
  const n = node(label, { totalMs: num(o["r_total_time_ms"]), loops: num(o["r_loops"]) ?? 1, cost: num((o["cost_info"] as Obj | undefined)?.["query_cost"]) });
  if (typeof o["sort_key"] === "string") n.conditions.push(`Sort Key: ${o["sort_key"]}`);
  if (o["using_temporary_table"] === true) n.warnings.push("Uses a temporary table");
  if (o["using_filesort"] === true) n.warnings.push("Sorts without an index (filesort)");
  for (const [k, v] of Object.entries(o)) {
    if (k === "table" && v && typeof v === "object") n.children.push(myTable(v as Obj));
    else if (k === "nested_loop" && Array.isArray(v)) {
      const loop = node("Nested loop join");
      loop.children = (v as Obj[]).map((x) => (x["table"] ? myTable(x["table"] as Obj) : myWalk(x, "Block")));
      const t = loop.children.reduce((a, c) => a + (c.totalMs ?? 0), 0);
      loop.totalMs = loop.children.some((c) => c.totalMs !== null) ? t : null;
      n.children.push(loop);
    } else if (k in OPS && v && typeof v === "object") n.children.push(myWalk(v as Obj, OPS[k]));
    else if ((k === "subqueries" || k === "query_specifications") && Array.isArray(v)) for (const s of v as Obj[]) n.children.push(myWalk((s["query_block"] as Obj) ?? s, "Subquery"));
    else if (k === "query_block" && v && typeof v === "object") n.children.push(myWalk(v as Obj, "Query block"));
    else if (typeof v !== "object") n.props.push([k, String(v)]);
  }
  // Query blocks report inclusive time; operations (filesort, temporary table…)
  // report only their own work, so add their children's time on top.
  const childMs = n.children.reduce((a, c) => a + (c.totalMs ?? 0), 0);
  const anyChildTime = n.children.some((c) => c.totalMs !== null);
  const isBlock = label === "Query" || label === "Query block" || label === "Subquery";
  if (!isBlock && (n.totalMs !== null || anyChildTime)) n.totalMs = (n.totalMs ?? 0) + childMs;
  else if (n.totalMs === null && anyChildTime) n.totalMs = childMs;
  return n;
}

export function parseMysqlPlan(json: unknown): Plan {
  const top = json as Obj;
  const qb = (top["query_block"] as Obj) ?? top;
  const root = myWalk(qb, "Query");
  finish(root);
  return { root, analyzed: num(qb["r_total_time_ms"]) !== null, planningMs: num((top["query_optimization"] as Obj | undefined)?.["r_total_time_ms"]), executionMs: num(qb["r_total_time_ms"]) };
}

// ── SQLite ────────────────────────────────────────────────────────────────

export function parseSqlitePlan(rows: (string | null)[][]): Plan {
  const root = node("Query");
  const byId = new Map<number, PlanNode>([[0, root]]);
  for (const r of rows) {
    const id = Number(r[0]);
    const parent = Number(r[1]);
    const detail = r[3] ?? "";
    const m = /^(SCAN|SEARCH|USE TEMP B-TREE FOR|CORRELATED SCALAR SUBQUERY|SCALAR SUBQUERY|LIST SUBQUERY|MATERIALIZE|CO-ROUTINE|COMPOUND QUERY|MULTI-INDEX OR)\s*(.*)$/.exec(detail);
    const n = node(m ? m[1].replace(" FOR", "") : detail, { detail: m ? m[2] : "" });
    if (/^SCAN /.test(detail) && !/USING (COVERING )?INDEX/.test(detail)) n.warnings.push(`Full scan of ${detail.replace(/^SCAN (TABLE )?/, "").split(" ")[0]} — an index could help if it's filtered`);
    if (/^USE TEMP B-TREE/.test(detail)) n.warnings.push(`Builds a temporary index to ${detail.replace(/^USE TEMP B-TREE FOR /, "").toLowerCase()} — an index matching it would avoid that`);
    byId.set(id, n);
    (byId.get(parent) ?? root).children.push(n);
  }
  return { root, analyzed: false, planningMs: null, executionMs: null };
}

// ── helpers for the view ──────────────────────────────────────────────────

export function flatten(root: PlanNode): { node: PlanNode; depth: number }[] {
  const out: { node: PlanNode; depth: number }[] = [];
  const walk = (n: PlanNode, depth: number) => {
    out.push({ node: n, depth });
    n.children.forEach((c) => walk(c, depth + 1));
  };
  walk(root, 0);
  return out;
}

/** The nodes that took the most time themselves. */
export function hotspots(plan: Plan, n = 3): PlanNode[] {
  return flatten(plan.root)
    .map((x) => x.node)
    .filter((x) => (x.selfMs ?? 0) > 0)
    .sort((a, b) => (b.selfMs ?? 0) - (a.selfMs ?? 0))
    .slice(0, n);
}

/** The EXPLAIN statement for a query, per engine; ANALYZE executes it. */
export function explainSql(kind: "postgres" | "mysql" | "sqlite", sql: string, analyze: boolean, mariadb: boolean): string {
  if (kind === "sqlite") return `EXPLAIN QUERY PLAN ${sql}`;
  if (kind === "postgres") return `EXPLAIN (${analyze ? "ANALYZE, BUFFERS, " : ""}FORMAT JSON) ${sql}`;
  return analyze && mariadb ? `ANALYZE FORMAT=JSON ${sql}` : `EXPLAIN FORMAT=JSON ${sql}`;
}

/** ANALYZE runs the statement: only allow it for plain reads. */
export function safeToAnalyze(sql: string): boolean {
  const s = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
  return /^(select|with|values|table)\b/i.test(s) && !/\b(insert|update|delete|merge|create|drop|alter|truncate|grant|call|lock)\b/i.test(s.replace(/'([^']|'')*'/g, "''"));
}
