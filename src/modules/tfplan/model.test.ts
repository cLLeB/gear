import { describe, expect, it } from "vitest";
import { actionOf, diffAttrs, flatten, parsePlan, pathString, SENSITIVE, summaryLine, toMarkdown, UNKNOWN } from "./model";

const plan = {
  format_version: "1.2",
  terraform_version: "1.9.5",
  resource_changes: [
    {
      address: "aws_s3_bucket.logs",
      type: "aws_s3_bucket",
      name: "logs",
      provider_name: "registry.terraform.io/hashicorp/aws",
      change: { actions: ["create"], before: null, after: { bucket: "logs", tags: { Team: "ops" } }, after_unknown: { arn: true, id: true }, after_sensitive: {} },
    },
    {
      address: "module.db.aws_db_instance.main",
      module_address: "module.db",
      type: "aws_db_instance",
      name: "main",
      provider_name: "registry.terraform.io/hashicorp/aws",
      action_reason: "replace_because_cannot_update",
      change: {
        actions: ["delete", "create"],
        before: { engine_version: "15.4", deletion_protection: true, password: "x", skip_final_snapshot: false },
        after: { engine_version: "16.1", deletion_protection: false, password: "y", skip_final_snapshot: true },
        after_unknown: { id: true },
        before_sensitive: { password: true },
        after_sensitive: { password: true },
        replace_paths: [["engine_version"]],
      },
    },
    {
      address: "aws_security_group_rule.ssh",
      type: "aws_security_group_rule",
      name: "ssh",
      provider_name: "registry.terraform.io/hashicorp/aws",
      change: { actions: ["update"], before: { cidr_blocks: ["10.0.0.0/8"], from_port: 22 }, after: { cidr_blocks: ["0.0.0.0/0"], from_port: 22 }, after_unknown: {} },
    },
    {
      address: "aws_iam_role_policy.ci",
      type: "aws_iam_role_policy",
      name: "ci",
      provider_name: "registry.terraform.io/hashicorp/aws",
      previous_address: "aws_iam_role_policy.old",
      change: { actions: ["no-op"], before: { a: 1 }, after: { a: 1 } },
    },
    {
      address: 'aws_instance.web["b"]',
      type: "aws_instance",
      name: "web",
      index: "b",
      provider_name: "registry.opentofu.org/hashicorp/aws",
      change: { actions: ["delete"], before: { ami: "ami-1" }, after: null },
    },
    {
      address: "aws_route53_record.www",
      type: "aws_route53_record",
      name: "www",
      provider_name: "registry.terraform.io/hashicorp/aws",
      change: { actions: ["create"], importing: { id: "Z1_www_A" }, before: null, after: { name: "www" } },
    },
  ],
  resource_drift: [{ address: "aws_s3_bucket.old", type: "aws_s3_bucket", name: "old", change: { actions: ["update"], before: { versioning: false }, after: { versioning: true } } }],
  output_changes: {
    url: { actions: ["update"], before: "a", after: null, after_unknown: true },
    token: { actions: ["create"], after: "secret", after_sensitive: true },
  },
};

describe("terraform plan", () => {
  it("names actions", () => {
    expect(actionOf(["delete", "create"])).toBe("replace");
    expect(actionOf(["create", "delete"])).toBe("replace");
    expect(actionOf(["update"])).toBe("update");
    expect(actionOf(["no-op"])).toBe("no-op");
    expect(actionOf([])).toBe("no-op");
  });

  it("flattens values with unknown and sensitive masks", () => {
    const m = flatten({ a: { b: [1, { c: "x" }] }, s: "hide", e: [], o: {} }, { a: { b: [false, false, true] }, n: true }, { s: true });
    expect([...m]).toEqual([
      ["a.b[0]", "1"],
      ["a.b[1].c", '"x"'],
      ["a.b[2]", UNKNOWN],
      ["e", "[]"],
      ["n", UNKNOWN],
      ["o", "{}"],
      ["s", SENSITIVE],
    ]);
    expect(pathString(["ingress", 0, "cidr_blocks"])).toBe("ingress[0].cidr_blocks");
  });

  it("diffs attributes and marks what forces replacement", () => {
    const d = diffAttrs({ before: { v: "1", same: 2, gone: "x", tags: { A: "1" } }, after: { v: "2", same: 2, tags: { A: "1", B: "2" } }, after_unknown: { id: true }, replace_paths: [["v"]] });
    expect(d).toEqual([
      { path: "gone", kind: "removed", before: '"x"', after: null, forcesReplace: false },
      { path: "id", kind: "added", before: null, after: UNKNOWN, forcesReplace: false },
      { path: "tags.B", kind: "added", before: null, after: '"2"', forcesReplace: false },
      { path: "v", kind: "changed", before: '"1"', after: '"2"', forcesReplace: true },
    ]);
  });

  it("reads a plan with counts, risks, moves, imports, drift and outputs", () => {
    const p = parsePlan(JSON.stringify(plan));
    expect(p.version).toBe("1.9.5");
    expect(p.counts).toEqual({ create: 2, update: 1, delete: 1, replace: 1, import: 1, move: 1 });
    expect(summaryLine(p)).toBe("Plan: 1 to import, 3 to add, 1 to change, 2 to destroy.");
    const db = p.changes[1];
    expect(db).toMatchObject({ action: "replace", module: "module.db", provider: "hashicorp/aws", reason: "replace_because_cannot_update" });
    expect(db.diffs.find((x) => x.path === "password")).toBeUndefined(); // sensitive on both sides, unchanged as far as anyone can tell
    expect(db.diffs.find((x) => x.path === "engine_version")?.forcesReplace).toBe(true);
    expect(db.risks.map((r) => r.message)).toEqual(["Replaces (destroys and recreates) a resource that holds data.", "Turns off deletion_protection.", "No final snapshot will be taken when this database is destroyed."]);
    expect(p.changes[2].risks).toEqual([{ level: "warning", message: 'Opens access to the whole internet (cidr_blocks[0] = "0.0.0.0/0").' }]);
    expect(p.changes[3]).toMatchObject({ action: "no-op", movedFrom: "aws_iam_role_policy.old", risks: [] });
    expect(p.changes[4]).toMatchObject({ name: 'web["b"]', action: "delete", provider: "hashicorp/aws", risks: [] });
    expect(p.changes[5].imported).toBe(true);
    expect(p.drift).toHaveLength(1);
    expect(p.outputs).toEqual([
      { name: "url", action: "update", before: '"a"', after: UNKNOWN, sensitive: false },
      { name: "token", action: "create", before: SENSITIVE, after: SENSITIVE, sensitive: true },
    ]);
  });

  it("rejects what is not a plan and reports an empty one", () => {
    expect(() => parsePlan("nope")).toThrow(/terraform show -json/);
    expect(() => parsePlan('{"a":1}')).toThrow(/not a Terraform plan/);
    expect(summaryLine(parsePlan('{"format_version":"1.2","resource_changes":[]}'))).toBe("No changes.");
  });

  it("writes a pull request comment", () => {
    const md = toMarkdown(parsePlan(JSON.stringify(plan)));
    expect(md).toContain("### Plan: 1 to import, 3 to add, 1 to change, 2 to destroy.");
    expect(md).toContain("- **Danger** `module.db.aws_db_instance.main`: Turns off deletion_protection.");
    expect(md).toContain('!     engine_version: "15.4" -> "16.1"  # forces replacement');
    expect(md).toContain("1 resource was changed outside Terraform");
  });
});
