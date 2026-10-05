import { describe, expect, it } from "vitest";
import { jsonToTypes } from "./jsonTypes";

const sample = {
  id: 1,
  name: "Ada",
  score: 9.5,
  tags: ["a"],
  address: { city: "London", zip: null },
  orders: [
    { orderId: 1, total: 3 },
    { orderId: 2, total: 4.5, note: "gift" },
  ],
};

describe("jsonToTypes", () => {
  it("emits TypeScript interfaces with merged array shapes", () => {
    const ts = jsonToTypes(sample, "typescript", "user");
    expect(ts).toContain("export interface User {");
    expect(ts).toContain("  orders: Order[];");
    expect(ts).toContain("export interface Order {");
    expect(ts).toContain("  total: number;");
    expect(ts).toContain("  note?: string;");
    expect(ts).toContain("  zip: null;");
    expect(ts).toContain("  tags: string[];");
  });

  it("reuses one name per shape and quotes odd keys", () => {
    const ts = jsonToTypes({ a: { x: 1 }, b: { x: 2 }, "content-type": "j" }, "typescript");
    expect(ts.match(/interface/g)).toHaveLength(2);
    expect(ts).toContain('"content-type": string;');
    expect(ts).toContain("  b: A;");
  });

  it("handles top-level arrays and unions", () => {
    const ts = jsonToTypes([1, "x", null], "typescript", "items");
    expect(ts).toContain("export type Items = (number | string | null)[];");
  });

  it("emits Zod schemas in dependency order", () => {
    const z = jsonToTypes(sample, "zod", "user");
    expect(z.indexOf("OrderSchema = z.object")).toBeLessThan(z.indexOf("UserSchema = z.object"));
    expect(z).toContain("note: z.string().optional(),");
    expect(z).toContain("orderId: z.number().int(),");
  });

  it("emits Go structs with json tags", () => {
    const go = jsonToTypes(sample, "go", "user");
    expect(go).toContain("type User struct {");
    expect(go).toContain('\tOrders []Order `json:"orders"`');
    expect(go).toContain('\tNote *string `json:"note,omitempty"`');
    expect(go).toContain('\tScore float64 `json:"score"`');
  });

  it("emits Rust serde structs", () => {
    const rs = jsonToTypes(sample, "rust", "user");
    expect(rs).toContain("pub struct User {");
    expect(rs).toContain('#[serde(rename = "orderId")]');
    expect(rs).toContain("pub order_id: i64,");
    expect(rs).toContain("pub note: Option<String>,");
  });

  it("emits Python dataclasses with optional fields last", () => {
    const py = jsonToTypes(sample, "python", "user");
    expect(py).toContain("class Order:");
    expect(py.indexOf("note: Optional[str] = None")).toBeGreaterThan(py.indexOf("total: float"));
    expect(py).toContain('order_id: int  # "orderId"');
  });
});
