// Terraform / OpenTofu plans in their JSON form (`terraform show -json
// <planfile>`): every resource change with its attribute diff, the plan's
// summary, and the changes worth a second look before `apply`.

export type Action = "create" | "update" | "delete" | "replace" | "read" | "no-op" | "forget";

export interface AttrDiff {
  path: string;
  kind: "added" | "removed" | "changed";
  before: string | null;
  after: string | null;
  /** Changing this attribute forces the resource to be replaced. */
  forcesReplace: boolean;
}

export interface Risk {
  level: "danger" | "warning";
  message: string;
}

export interface Change {
  address: string;
  module: string;
  type: string;
  name: string;
  provider: string;
  action: Action;
  reason: string | null;
  /** The address it was moved from, when `moved` blocks moved it. */
  movedFrom: string | null;
  imported: boolean;
  diffs: AttrDiff[];
  risks: Risk[];
}

export interface Plan {
  version: string | null;
  changes: Change[];
  /** Changes made outside Terraform since the last apply. */
  drift: Change[];
  outputs: { name: string; action: Action; before: string | null; after: string | null; sensitive: boolean }[];
  counts: Record<"create" | "update" | "delete" | "replace" | "import" | "move", number>;
  errored: boolean;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function actionOf(actions: unknown): Action {
  const a = arr(actions).map(String);
  if (a.length === 2 && a.includes("create") && a.includes("delete")) return "replace";
  const one = a[0];
  return one === "create" || one === "update" || one === "delete" || one === "read" || one === "forget" ? one : "no-op";
}

export const UNKNOWN = "(known after apply)";
export const SENSITIVE = "(sensitive value)";

const render = (v: unknown): string => (typeof v === "string" ? JSON.stringify(v) : v === undefined ? "null" : JSON.stringify(v));

/**
 * Flattens a value into dotted paths (`tags.Name`, `ingress[0].cidr_blocks[1]`),
 * with `unknown` and `sensitive` masks applied: masked leaves (or whole
 * masked subtrees) show as placeholders.
 */
export function flatten(value: unknown, unknown: unknown, sensitive: unknown, prefix = "", out = new Map<string, string>()): Map<string, string> {
  if (sensitive === true) {
    out.set(prefix || "(value)", SENSITIVE);
    return out;
  }
  if (unknown === true) {
    out.set(prefix || "(value)", UNKNOWN);
    return out;
  }
  const join = (k: string | number) => (typeof k === "number" ? `${prefix}[${k}]` : prefix ? `${prefix}.${k}` : k);
  if (Array.isArray(value)) {
    const us = Array.isArray(unknown) ? unknown : [];
    const ss = Array.isArray(sensitive) ? sensitive : [];
    // A list can grow only through unknown elements.
    const n = Math.max(value.length, us.length);
    if (n === 0) out.set(prefix, "[]");
    for (let i = 0; i < n; i++) flatten(value[i], us[i], ss[i], join(i), out);
    return out;
  }
  if (value && typeof value === "object") {
    const u = obj(unknown);
    const s = obj(sensitive);
    const keys = [...new Set([...Object.keys(value as Json), ...Object.keys(u).filter((k) => u[k] === true)])].sort();
    if (keys.length === 0) out.set(prefix, "{}");
    for (const k of keys) flatten((value as Json)[k], u[k], s[k], join(k), out);
    return out;
  }
  if (value === undefined && prefix === "") return out;
  out.set(prefix || "(value)", render(value === undefined ? null : value));
  return out;
}

/** `replace_paths` entries (lists of keys and indexes) as the dotted paths `flatten` makes. */
export function pathString(steps: unknown[]): string {
  return steps.reduce<string>((p, s) => (typeof s === "number" ? `${p}[${s}]` : p ? `${p}.${String(s)}` : String(s)), "");
}

export function diffAttrs(change: Json): AttrDiff[] {
  const before = flatten(change.before, undefined, change.before_sensitive);
  const after = flatten(change.after, change.after_unknown, change.after_sensitive);
  const replace = arr(change.replace_paths).map((p) => pathString(arr(p)));
  const forces = (path: string) => replace.some((r) => path === r || path.startsWith(`${r}.`) || path.startsWith(`${r}[`));
  const out: AttrDiff[] = [];
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const b = before.get(path) ?? null;
    const a = after.get(path) ?? null;
    if (b === a) continue;
    // A null that becomes absent (or the reverse) is not a change worth showing.
    if ((b === null || b === "null") && (a === null || a === "null")) continue;
    out.push({ path, kind: b === null || b === "null" ? "added" : a === null || a === "null" ? "removed" : "changed", before: b, after: a, forcesReplace: forces(path) });
  }
  return out;
}

/** Resource types that hold data: destroying or replacing them loses it. */
const STATEFUL = /(_db_|_database|_rds_|_sql_|_bucket$|_bucket_v2$|_storage_account|_storage_bucket|_dynamodb_table|_efs_file_system|_ebs_volume|_disk$|_persistent_volume|_elasticache|_redis|_kms_key|_key_vault$|_secret$|_secretsmanager_secret|_cosmosdb|_bigquery_dataset|_bigquery_table|_spanner|_firestore|_backup_vault|_log_group$|_ecr_repository|_route53_zone|_dns_zone|_managed_disk)/;
const IAM = /(_iam_|_role_assignment|_role_definition|_policy$|_policy_attachment|_service_account$|_service_account_key|_access_key|_kms_grant)/;

export function risksOf(c: Pick<Change, "type" | "action" | "diffs" | "address">): Risk[] {
  const risks: Risk[] = [];
  const stateful = STATEFUL.test(c.type);
  if (c.action === "delete" && stateful) risks.push({ level: "danger", message: "Destroys a resource that holds data." });
  else if (c.action === "replace" && stateful) risks.push({ level: "danger", message: "Replaces (destroys and recreates) a resource that holds data." });
  else if (c.action === "replace") risks.push({ level: "warning", message: "Replaced: the resource is destroyed and recreated, with a new ID." });
  if (IAM.test(c.type) && c.action !== "no-op" && c.action !== "read") risks.push({ level: "warning", message: "Changes who can access what (IAM)." });
  for (const d of c.diffs) {
    if (/(^|\.)deletion_protection$|(^|\.)prevent_destroy$|(^|\.)termination_protection$|(^|\.)enable_deletion_protection$/.test(d.path) && d.after === "false") risks.push({ level: "danger", message: `Turns off ${d.path}.` });
    if (/(^|\.)(publicly_accessible|public|map_public_ip_on_launch|block_public_acls|block_public_policy|restrict_public_buckets|ignore_public_acls)$/.test(d.path)) {
      const opens = /^(publicly_accessible|public|map_public_ip_on_launch)$/.test(d.path.split(".").pop() as string) ? d.after === "true" : d.after === "false";
      if (opens) risks.push({ level: "danger", message: `Makes it public: ${d.path} = ${d.after}.` });
    }
    if (/cidr_blocks?(\[\d+\])?$|cidr_ipv4$|source_address_prefix(es)?(\[\d+\])?$|source_ranges(\[\d+\])?$/.test(d.path) && (d.after === '"0.0.0.0/0"' || d.after === '"::/0"' || d.after === '"*"' || d.after === '"Internet"')) {
      risks.push({ level: "warning", message: `Opens access to the whole internet (${d.path} = ${d.after}).` });
    }
    if (/(^|\.)(skip_final_snapshot)$/.test(d.path) && d.after === "true") risks.push({ level: "warning", message: "No final snapshot will be taken when this database is destroyed." });
    if (/(^|\.)(encrypted|storage_encrypted|enable_encryption)$/.test(d.path) && d.after === "false") risks.push({ level: "warning", message: `Turns off encryption (${d.path}).` });
  }
  // One message once.
  return risks.filter((r, i) => risks.findIndex((x) => x.message === r.message) === i);
}

function readChange(rc: Json): Change {
  const change = obj(rc.change);
  const action = actionOf(change.actions);
  const diffs = action === "no-op" || action === "read" ? [] : diffAttrs(change);
  const base = {
    address: String(rc.address ?? ""),
    module: String(rc.module_address ?? ""),
    type: String(rc.type ?? ""),
    name: String(rc.name ?? "") + (rc.index !== undefined ? `[${JSON.stringify(rc.index)}]` : ""),
    provider: String(rc.provider_name ?? "").replace(/^registry\.(terraform\.io|opentofu\.org)\//, ""),
    action,
    reason: typeof rc.action_reason === "string" ? rc.action_reason : null,
    movedFrom: typeof rc.previous_address === "string" && rc.previous_address !== rc.address ? rc.previous_address : null,
    imported: !!change.importing,
    diffs,
  };
  return { ...base, risks: risksOf(base) };
}

/** Reads `terraform show -json` output for a plan. */
export function parsePlan(text: string): Plan {
  let doc: Json;
  try {
    doc = obj(JSON.parse(text));
  } catch {
    throw new Error("This is not JSON. Turn a saved plan into JSON with: terraform show -json plan.tfplan > plan.json");
  }
  if (!("resource_changes" in doc) && !("planned_values" in doc) && !("format_version" in doc)) throw new Error("This JSON is not a Terraform plan (no resource_changes).");
  const changes = arr(doc.resource_changes).map((r) => readChange(obj(r)));
  const drift = arr(doc.resource_drift)
    .map((r) => readChange(obj(r)))
    .filter((c) => c.action !== "no-op");
  const outputs = Object.entries(obj(doc.output_changes)).map(([name, v]) => {
    const ch = obj(v);
    const sensitive = ch.after_sensitive === true || ch.before_sensitive === true;
    const show = (x: unknown, unknown?: unknown) => (sensitive ? SENSITIVE : unknown === true ? UNKNOWN : x === undefined || x === null ? null : render(x));
    return { name, action: actionOf(ch.actions), before: show(ch.before), after: show(ch.after, ch.after_unknown), sensitive };
  });
  const counts = { create: 0, update: 0, delete: 0, replace: 0, import: 0, move: 0 };
  for (const c of changes) {
    if (c.action === "create" || c.action === "update" || c.action === "delete" || c.action === "replace") counts[c.action]++;
    if (c.imported) counts.import++;
    if (c.movedFrom) counts.move++;
  }
  return { version: typeof doc.terraform_version === "string" ? doc.terraform_version : null, changes, drift, outputs, counts, errored: doc.errored === true };
}

/** "Plan: 2 to add, 1 to change, 1 to destroy." the way Terraform counts (a replace is one add and one destroy). */
export function summaryLine(p: Plan): string {
  const add = p.counts.create + p.counts.replace;
  const destroy = p.counts.delete + p.counts.replace;
  const parts = [];
  if (p.counts.import) parts.push(`${p.counts.import} to import`);
  parts.push(`${add} to add`, `${p.counts.update} to change`, `${destroy} to destroy`);
  return add + p.counts.update + destroy + p.counts.import === 0 ? "No changes." : `Plan: ${parts.join(", ")}.`;
}

export const ACTION_SYMBOL: Record<Action, string> = { create: "+", update: "~", delete: "-", replace: "-/+", read: "<=", "no-op": " ", forget: "." };

/** The plan as a Markdown comment for a pull request. */
export function toMarkdown(p: Plan): string {
  const real = p.changes.filter((c) => c.action !== "no-op" && c.action !== "read");
  const lines = [`### ${summaryLine(p)}`];
  const risky = real.filter((c) => c.risks.length);
  if (risky.length) {
    lines.push("", "**Needs a second look:**", "");
    for (const c of risky) for (const r of c.risks) lines.push(`- ${r.level === "danger" ? "**Danger**" : "Warning"} \`${c.address}\`: ${r.message}`);
  }
  if (real.length) {
    lines.push("", "<details><summary>Changes</summary>", "", "```diff");
    for (const c of real) {
      const sign = c.action === "create" ? "+" : c.action === "delete" ? "-" : c.action === "replace" ? "!" : "~";
      lines.push(`${sign} ${c.address} (${c.action}${c.movedFrom ? `, moved from ${c.movedFrom}` : ""})`);
      for (const d of c.diffs.slice(0, 30)) {
        if (c.action === "create" || c.action === "delete") continue;
        lines.push(`!     ${d.path}: ${d.before ?? "null"} -> ${d.after ?? "null"}${d.forcesReplace ? "  # forces replacement" : ""}`);
      }
    }
    lines.push("```", "", "</details>");
  }
  if (p.drift.length) lines.push("", `${p.drift.length} resource${p.drift.length === 1 ? " was" : "s were"} changed outside Terraform since the last apply.`);
  return lines.join("\n");
}
