import { describe, expect, it } from "vitest";
import { columnY, crossings, edgePath, edgesOf, layers, layout, nodeSize, tableKey } from "./er";
import type { TableInfo } from "./store";

const col = (name: string, pk = false) => ({ name, dataType: "integer", nullable: !pk, primaryKey: pk });
const t = (name: string, cols: string[], fks: [string[], string, string[]][] = []): TableInfo => ({
  schema: "public",
  name,
  kind: "table",
  columns: [col("id", true), ...cols.map((c) => col(c))],
  foreignKeys: fks.map(([columns, refTable, refColumns], i) => ({ name: `${name}_fk${i}`, columns, refSchema: "public", refTable, refColumns })),
});

// A shop: customers ← orders ← order_items → products → categories (self-referencing), plus unrelated tables.
const shop = [
  t("order_items", ["order_id", "product_id", "qty"], [[["order_id"], "orders", ["id"]], [["product_id"], "products", ["id"]]]),
  t("orders", ["customer_id", "total"], [[["customer_id"], "customers", ["id"]]]),
  t("customers", ["email"]),
  t("products", ["category_id", "name"], [[["category_id"], "categories", ["id"]]]),
  t("categories", ["parent_id"], [[["parent_id"], "categories", ["id"]]]),
  t("audit_log", ["what"]),
  t("settings", ["k", "v"]),
];

describe("ER layout", () => {
  it("puts referenced tables left of the tables that reference them", () => {
    const { nodes, edges } = layout(shop);
    const at = (n: string) => nodes.find((x) => x.key === tableKey("public", n))!;
    expect(edges).toHaveLength(5);
    for (const e of edges.filter((e) => e.from !== e.to)) expect(nodes.find((n) => n.key === e.from)!.layer).toBeGreaterThan(nodes.find((n) => n.key === e.to)!.layer);
    expect(at("customers").layer).toBe(0);
    expect(at("categories").layer).toBe(0);
    expect(at("order_items").layer).toBe(2);
    // Unrelated tables go in the grid below everything else.
    expect(at("audit_log").layer).toBe(-1);
    expect(at("audit_log").y).toBeGreaterThan(Math.max(...nodes.filter((n) => n.layer >= 0).map((n) => n.y + n.h)));
    expect(crossings(nodes, edges)).toBe(0);
  });

  it("never overlaps boxes", () => {
    const many = Array.from({ length: 40 }, (_, i) => t(`t${i}`, ["a", "b"], i > 0 ? [[["a"], `t${Math.floor(i / 3)}`, ["id"]]] : []));
    const { nodes } = layout(many);
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.key} / ${b.key}`).toBe(false);
      }
  });

  it("breaks cycles and handles composite keys", () => {
    const cyc = [t("a", ["b_id"], [[["b_id"], "b", ["id"]]]), t("b", ["a_id"], [[["a_id"], "a", ["id"]]])];
    const l = layers(["public.a", "public.b"], edgesOf(cyc));
    expect(new Set(l.values())).toEqual(new Set([0, 1]));
    const comp = [t("line", ["order_id", "region"], [[["order_id", "region"], "orders", ["id", "region"]]]), t("orders", ["region"])];
    expect(edgesOf(comp)[0]).toMatchObject({ columns: ["order_id", "region"], refColumns: ["id", "region"] });
    // Tables from older backends have no foreignKeys at all.
    expect(edgesOf([{ ...shop[0], foreignKeys: undefined }])).toEqual([]);
  });

  it("sizes boxes and anchors edges on columns", () => {
    const big = t("order_items", ["order_id", "product_id", "qty"], [[["order_id"], "orders", ["id"]]]);
    expect(nodeSize(big, false).h).toBe(26 + 4 * 18 + 6);
    // Keys only: id (pk) + order_id (fk).
    expect(nodeSize(big, true).h).toBe(26 + 2 * 18 + 6);
    const { nodes } = layout(shop);
    const oi = nodes.find((n) => n.table.name === "order_items")!;
    const o = nodes.find((n) => n.table.name === "orders")!;
    expect(columnY(oi, "product_id", false)).toBe(oi.y + 26 + 2 * 18 + 9);
    expect(edgePath(oi, columnY(oi, "order_id", false), o, columnY(o, "id", false))).toMatch(new RegExp(`^M ${oi.x} `));
  });
});
