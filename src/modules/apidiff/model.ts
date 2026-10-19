// What changed between two versions of an OpenAPI (3.x) or Swagger (2.0)
// description, and whether each change breaks existing clients. Requests
// and responses are judged in opposite directions: a server may start
// accepting more and returning less-constrained data only so far — a new
// required request field breaks callers, a removed response field breaks
// readers.

export type Severity = "breaking" | "risky" | "safe";

export interface ApiChange {
  severity: Severity;
  /** "GET /pets/{id}", or "(spec)" for document-level changes. */
  operation: string;
  /** Where in the operation: "query parameter limit", "request body: owner.name", "200 response: items[].id". */
  where: string;
  message: string;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

/** Follows local `$ref`s (`#/components/schemas/Pet`, `#/definitions/Pet`, `#/components/parameters/…`). */
export function resolver(doc: Json): (v: unknown) => Json {
  return (v) => {
    let cur = obj(v);
    const seen = new Set<string>();
    while (typeof cur.$ref === "string" && cur.$ref.startsWith("#/") && !seen.has(cur.$ref)) {
      seen.add(cur.$ref);
      let target: unknown = doc;
      for (const part of cur.$ref.slice(2).split("/")) target = obj(target)[part.replace(/~1/g, "/").replace(/~0/g, "~")];
      cur = obj(target);
    }
    return cur;
  };
}

const typeOf = (s: Json): string | null => {
  const t = s.type;
  if (Array.isArray(t)) return t.filter((x) => x !== "null").join("|") || null;
  if (typeof t === "string") return t;
  if (s.properties) return "object";
  if (s.items) return "array";
  return null;
};
const nullable = (s: Json) => s.nullable === true || (Array.isArray(s.type) && s.type.includes("null"));

/** Integer to number widens a request (fine) but widens a response (clients parsing ints break). */
function typeChange(before: string, after: string, dir: "request" | "response"): Severity {
  if (dir === "request" && before === "integer" && after === "number") return "safe";
  if (dir === "response" && before === "number" && after === "integer") return "safe";
  return "breaking";
}

interface Ctx {
  rb: (v: unknown) => Json;
  ra: (v: unknown) => Json;
  out: ApiChange[];
  op: string;
  /** Where in the operation the compared schema sits: "request body", "200 response", "query parameter limit". */
  label: string;
  seen: Set<string>;
}

const at = (ctx: Ctx, where: string) => (where ? (ctx.label ? `${ctx.label}: ${where}` : where) : ctx.label);

/** Compares two schemas at `where`, in the request or response direction. */
function compareSchema(ctx: Ctx, bRaw: unknown, aRaw: unknown, where: string, dir: "request" | "response", depth = 0): void {
  if (depth > 12) return;
  const key = `${dir}|${obj(bRaw).$ref ?? ""}|${obj(aRaw).$ref ?? ""}`;
  if ((obj(bRaw).$ref || obj(aRaw).$ref) && ctx.seen.has(key)) return;
  ctx.seen.add(key);
  const b = ctx.rb(bRaw);
  const a = ctx.ra(aRaw);
  const add = (severity: Severity, message: string) => ctx.out.push({ severity, operation: ctx.op, where: at(ctx, where), message });
  const tb = typeOf(b);
  const ta = typeOf(a);
  if (tb && ta && tb !== ta) {
    add(typeChange(tb, ta, dir), `Type changed from ${tb} to ${ta}.`);
    return;
  }
  if (b.format !== a.format && b.format && a.format) add("breaking", `Format changed from ${String(b.format)} to ${String(a.format)}.`);
  else if (!b.format && a.format && dir === "request") add("risky", `Now requires format ${String(a.format)}.`);
  if (nullable(b) && !nullable(a)) add(dir === "request" ? "breaking" : "safe", "No longer nullable.");
  if (!nullable(b) && nullable(a)) add(dir === "response" ? "breaking" : "safe", dir === "response" ? "Can now be null." : "Now accepts null.");

  // Enums: requests may only grow, responses may only shrink.
  const eb = arr(b.enum).map((x) => JSON.stringify(x));
  const ea = arr(a.enum).map((x) => JSON.stringify(x));
  if (eb.length || ea.length) {
    const removed = eb.filter((x) => !ea.includes(x));
    const added = ea.filter((x) => !eb.includes(x));
    if (ea.length && !eb.length) add(dir === "request" ? "breaking" : "safe", `Now limited to ${ea.join(", ")}.`);
    if (removed.length && ea.length) add(dir === "request" ? "breaking" : "safe", `Value${removed.length === 1 ? "" : "s"} ${removed.join(", ")} no longer ${dir === "request" ? "accepted" : "returned"}.`);
    if (added.length && eb.length) add(dir === "response" ? "risky" : "safe", `New value${added.length === 1 ? "" : "s"} ${added.join(", ")}${dir === "response" ? " may be returned; clients with exhaustive handling may break" : " accepted"}.`);
  }

  // Bounds: tighter request bounds reject what used to pass.
  const tighter = (k: string, lower: boolean) => {
    const vb = b[k];
    const va = a[k];
    if (typeof va !== "number") return;
    if (typeof vb !== "number" || (lower ? va > vb : va < vb)) add(dir === "request" ? "breaking" : "safe", `${k} ${typeof vb === "number" ? `changed from ${vb} to ${va}` : `set to ${va}`}.`);
  };
  for (const k of ["minimum", "exclusiveMinimum", "minLength", "minItems"]) tighter(k, true);
  for (const k of ["maximum", "exclusiveMaximum", "maxLength", "maxItems"]) tighter(k, false);
  if (typeof a.pattern === "string" && a.pattern !== b.pattern) add(dir === "request" ? "risky" : "safe", `Pattern ${b.pattern ? "changed" : "added"}: ${a.pattern}.`);

  // Objects.
  const pb = obj(b.properties);
  const pa = obj(a.properties);
  const reqB = new Set(arr(b.required).map(String));
  const reqA = new Set(arr(a.required).map(String));
  const child = (name: string) => (where ? `${where}.${name}` : name);
  for (const name of Object.keys(pb)) {
    if (!(name in pa)) {
      if (dir === "response") ctx.out.push({ severity: "breaking", operation: ctx.op, where: at(ctx, child(name)), message: "Property removed from the response." });
      else if (a.additionalProperties === false) ctx.out.push({ severity: "breaking", operation: ctx.op, where: at(ctx, child(name)), message: "Property removed; the schema rejects unknown properties, so callers that send it now fail." });
      else ctx.out.push({ severity: "risky", operation: ctx.op, where: at(ctx, child(name)), message: "Property removed; callers that send it are ignored or rejected." });
    }
  }
  for (const name of Object.keys(pa)) {
    if (!(name in pb)) {
      const required = reqA.has(name);
      if (dir === "request") ctx.out.push({ severity: required ? "breaking" : "safe", operation: ctx.op, where: at(ctx, child(name)), message: required ? "New required property; existing callers do not send it." : "New optional property." });
      else ctx.out.push({ severity: "safe", operation: ctx.op, where: at(ctx, child(name)), message: "New property in the response." });
    }
  }
  for (const name of Object.keys(pa)) {
    if (!(name in pb)) continue;
    if (!reqB.has(name) && reqA.has(name)) ctx.out.push({ severity: dir === "request" ? "breaking" : "safe", operation: ctx.op, where: at(ctx, child(name)), message: dir === "request" ? "Became required." : "Now always returned." });
    if (reqB.has(name) && !reqA.has(name)) ctx.out.push({ severity: dir === "response" ? "breaking" : "safe", operation: ctx.op, where: at(ctx, child(name)), message: dir === "response" ? "No longer always returned; clients that rely on it may break." : "No longer required." });
    const sb = ctx.rb(pb[name]);
    const sa = ctx.ra(pa[name]);
    if (dir === "request" && !sb.readOnly && sa.readOnly) ctx.out.push({ severity: "risky", operation: ctx.op, where: at(ctx, child(name)), message: "Became read-only." });
    compareSchema(ctx, pb[name], pa[name], child(name), dir, depth + 1);
  }
  if (b.additionalProperties !== false && a.additionalProperties === false && dir === "request") add("risky", "No longer accepts unknown properties.");

  // Arrays.
  if (b.items || a.items) compareSchema(ctx, b.items, a.items, `${where}[]`, dir, depth + 1);

  // Compositions, compared position by position (oneOf/anyOf variants dropped from a response are fine).
  for (const k of ["allOf", "oneOf", "anyOf"]) {
    const xb = arr(b[k]);
    const xa = arr(a[k]);
    if (xb.length !== xa.length && (xb.length || xa.length)) add(k === "allOf" || dir === "request" ? (xa.length < xb.length ? "breaking" : "risky") : xa.length > xb.length ? "risky" : "safe", `${k} went from ${xb.length} to ${xa.length} schemas.`);
    for (let i = 0; i < Math.min(xb.length, xa.length); i++) compareSchema(ctx, xb[i], xa[i], where, dir, depth + 1);
  }
}

interface Param {
  name: string;
  in: string;
  required: boolean;
  schema: unknown;
}

function params(r: (v: unknown) => Json, pathItem: Json, op: Json): Map<string, Param> {
  const m = new Map<string, Param>();
  for (const raw of [...arr(pathItem.parameters), ...arr(op.parameters)]) {
    const p = r(raw);
    if (typeof p.name !== "string" || typeof p.in !== "string" || p.in === "body") continue;
    // Swagger 2 puts the schema keys on the parameter itself.
    const schema = p.schema ?? (p.type ? { type: p.type, format: p.format, enum: p.enum, items: p.items, minimum: p.minimum, maximum: p.maximum, maxLength: p.maxLength, minLength: p.minLength, pattern: p.pattern } : {});
    m.set(`${p.in}:${p.name.toLowerCase()}`, { name: p.name, in: p.in, required: p.required === true || p.in === "path", schema });
  }
  return m;
}

/** The request body schema (3.x `requestBody`, 2.0 `in: body` parameter) and whether it is required. */
function requestBody(r: (v: unknown) => Json, pathItem: Json, op: Json): { required: boolean; media: Map<string, unknown> } | null {
  const rb = op.requestBody ? r(op.requestBody) : null;
  if (rb) {
    const media = new Map<string, unknown>();
    for (const [type, m] of Object.entries(obj(rb.content))) media.set(type, obj(m).schema);
    return { required: rb.required === true, media };
  }
  const body = [...arr(pathItem.parameters), ...arr(op.parameters)].map(r).find((p) => p.in === "body");
  if (body) return { required: body.required === true, media: new Map([["application/json", body.schema]]) };
  return null;
}

function responses(r: (v: unknown) => Json, op: Json): Map<string, Map<string, unknown>> {
  const m = new Map<string, Map<string, unknown>>();
  for (const [code, raw] of Object.entries(obj(op.responses))) {
    const res = r(raw);
    const media = new Map<string, unknown>();
    for (const [type, mt] of Object.entries(obj(res.content))) media.set(type, obj(mt).schema);
    if (res.schema) media.set("application/json", res.schema);
    m.set(code, media);
  }
  return m;
}

const security = (doc: Json, op: Json) => JSON.stringify(op.security ?? doc.security ?? []);
/** `/pets/{petId}` and `/pets/{id}` are the same route. */
const routeKey = (p: string) => p.replace(/\{[^}]*\}/g, "{}").replace(/\/+$/, "") || "/";

/** Compares `before` and `after` (parsed JSON or YAML documents). */
export function diffSpecs(before: unknown, after: unknown): ApiChange[] {
  const db = obj(before);
  const da = obj(after);
  if (!db.openapi && !db.swagger) throw new Error("The earlier version is not an OpenAPI or Swagger document.");
  if (!da.openapi && !da.swagger) throw new Error("The current version is not an OpenAPI or Swagger document.");
  const rb = resolver(db);
  const ra = resolver(da);
  const out: ApiChange[] = [];
  const pathsB = new Map(Object.entries(obj(db.paths)).map(([p, v]) => [routeKey(p), { path: p, item: rb(v) }]));
  const pathsA = new Map(Object.entries(obj(da.paths)).map(([p, v]) => [routeKey(p), { path: p, item: ra(v) }]));
  const basePath = (d: Json) => (typeof d.basePath === "string" ? d.basePath.replace(/\/$/, "") : "");
  if (basePath(db) !== basePath(da)) out.push({ severity: "breaking", operation: "(spec)", where: "basePath", message: `Base path changed from ${basePath(db) || "/"} to ${basePath(da) || "/"}.` });
  const servers = (d: Json) => arr(d.servers).map((s) => String(obj(s).url ?? "")).sort().join(", ");
  if (servers(db) !== servers(da) && servers(db)) out.push({ severity: "risky", operation: "(spec)", where: "servers", message: `Servers changed from ${servers(db)} to ${servers(da) || "none"}.` });

  for (const [key, { path, item: ib }] of pathsB) {
    const ia = pathsA.get(key)?.item;
    for (const m of METHODS) {
      if (!ib[m]) continue;
      const opName = `${m.toUpperCase()} ${path}`;
      if (!ia || !ia[m]) {
        out.push({ severity: obj(ib[m]).deprecated === true ? "risky" : "breaking", operation: opName, where: "", message: obj(ib[m]).deprecated === true ? "Deprecated operation removed." : "Operation removed." });
        continue;
      }
      const ob = obj(ib[m]);
      const oa = obj(ia[m]);
      const ctx: Ctx = { rb, ra, out, op: opName, label: "", seen: new Set() };
      const compareAt = (label: string, b: unknown, a: unknown, dir: "request" | "response") => {
        ctx.label = label;
        ctx.seen.clear();
        compareSchema(ctx, b, a, "", dir);
      };
      if (!ob.deprecated && oa.deprecated) out.push({ severity: "safe", operation: opName, where: "", message: "Marked deprecated." });
      if (ob.operationId && oa.operationId && ob.operationId !== oa.operationId) out.push({ severity: "risky", operation: opName, where: "operationId", message: `operationId changed from ${String(ob.operationId)} to ${String(oa.operationId)}; generated clients rename the method.` });
      if (security(db, ob) !== security(da, oa)) out.push({ severity: security(da, oa) === "[]" ? "safe" : "breaking", operation: opName, where: "security", message: security(da, oa) === "[]" ? "No longer requires authentication." : `Authentication requirements changed to ${security(da, oa)}.` });

      // Parameters.
      const pb = params(rb, ib, ob);
      const pa = params(ra, ia, oa);
      for (const [k, p] of pb) {
        const q = pa.get(k);
        const label = `${p.in} parameter ${p.name}`;
        if (!q) {
          if (p.in !== "path") out.push({ severity: "risky", operation: opName, where: label, message: "Parameter removed; callers that send it are ignored or rejected." });
          continue;
        }
        if (!p.required && q.required) out.push({ severity: "breaking", operation: opName, where: label, message: "Became required." });
        if (p.required && !q.required) out.push({ severity: "safe", operation: opName, where: label, message: "No longer required." });
        compareAt(label, p.schema, q.schema, "request");
      }
      for (const [k, q] of pa) if (!pb.has(k)) out.push({ severity: q.required ? "breaking" : "safe", operation: opName, where: `${q.in} parameter ${q.name}`, message: q.required ? "New required parameter." : "New optional parameter." });

      // Request body.
      const bb = requestBody(rb, ib, ob);
      const ba = requestBody(ra, ia, oa);
      if (!bb && ba?.required) out.push({ severity: "breaking", operation: opName, where: "request body", message: "Now requires a request body." });
      if (bb && !ba) out.push({ severity: "risky", operation: opName, where: "request body", message: "Request body removed." });
      if (bb && ba) {
        if (!bb.required && ba.required) out.push({ severity: "breaking", operation: opName, where: "request body", message: "Request body became required." });
        for (const [type, s] of bb.media) {
          if (!ba.media.has(type)) {
            out.push({ severity: "breaking", operation: opName, where: "request body", message: `No longer accepts ${type}.` });
            continue;
          }
          compareAt("request body", s, ba.media.get(type), "request");
        }
      }

      // Responses.
      const rsb = responses(rb, ob);
      const rsa = responses(ra, oa);
      for (const [code, mb] of rsb) {
        const ma = rsa.get(code);
        const label = `${code} response`;
        if (!ma) {
          out.push({ severity: /^2/.test(code) ? "breaking" : "risky", operation: opName, where: label, message: `${code} response removed.` });
          continue;
        }
        for (const [type, s] of mb) {
          if (!ma.has(type)) {
            out.push({ severity: "breaking", operation: opName, where: label, message: `No longer returns ${type}.` });
            continue;
          }
          compareAt(label, s, ma.get(type), "response");
        }
      }
      for (const code of rsa.keys()) if (!rsb.has(code)) out.push({ severity: "safe", operation: opName, where: `${code} response`, message: `New ${code} response.` });
    }
  }
  for (const [key, { path, item }] of pathsA) {
    const ib = pathsB.get(key)?.item;
    for (const m of METHODS) if (item[m] && !ib?.[m]) out.push({ severity: "safe", operation: `${m.toUpperCase()} ${path}`, where: "", message: "New operation." });
  }
  const rank: Record<Severity, number> = { breaking: 0, risky: 1, safe: 2 };
  return out.sort((x, y) => rank[x.severity] - rank[y.severity] || x.operation.localeCompare(y.operation));
}

/** Release notes for an API change, breaking changes first. */
export function toMarkdown(changes: ApiChange[], label: string): string {
  const count = (s: Severity) => changes.filter((c) => c.severity === s).length;
  const lines = [`## API changes ${label}`, "", `${count("breaking")} breaking, ${count("risky")} to check, ${count("safe")} compatible.`];
  for (const [s, title] of [
    ["breaking", "Breaking"],
    ["risky", "Check these"],
    ["safe", "Compatible"],
  ] as [Severity, string][]) {
    const list = changes.filter((c) => c.severity === s);
    if (!list.length) continue;
    lines.push("", `### ${title}`, "");
    for (const c of list) lines.push(`- \`${c.operation}\`${c.where ? ` ${c.where}` : ""}: ${c.message}`);
  }
  return lines.join("\n");
}
