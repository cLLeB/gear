// Pure helpers for data and config files: a JSONPath evaluator, OpenAPI
// endpoint listing, Dockerfile / GitHub Actions / Kubernetes linters, CSV
// column statistics, filtering and sorting, Markdown table column edits,
// paste re-indentation, barrel files and function ⇄ arrow conversion.

import { parseCsv, stringifyCsv } from "@/lib/lang/csv";
import { alignOf, isSeparatorRow, renderMarkdown, splitRow, type Align } from "@/modules/editor/lib/textTools/tables";

// ── JSONPath ──────────────────────────────────────────────────────────────

type Seg =
  | { t: "key"; k: string }
  | { t: "index"; i: number }
  | { t: "wild" }
  | { t: "desc" }
  | { t: "slice"; s?: number; e?: number; step?: number }
  | { t: "union"; keys: (string | number)[] }
  | { t: "filter"; expr: string };

function parsePath(path: string): Seg[] {
  let p = path.trim();
  if (p.startsWith("$")) p = p.slice(1);
  else if (p && !p.startsWith(".") && !p.startsWith("[")) p = `.${p}`;
  const segs: Seg[] = [];
  let i = 0;
  while (i < p.length) {
    if (p.startsWith("..", i)) {
      segs.push({ t: "desc" });
      i += 2;
      if (p[i] === "[") continue;
      const m = /^(\*|[\w$-]+)/.exec(p.slice(i));
      if (!m) throw new Error(`Bad path near "${p.slice(i)}"`);
      segs.push(m[1] === "*" ? { t: "wild" } : { t: "key", k: m[1] });
      i += m[1].length;
    } else if (p[i] === ".") {
      const m = /^(\*|[\w$-]+)/.exec(p.slice(i + 1));
      if (!m) throw new Error(`Bad path near "${p.slice(i)}"`);
      segs.push(m[1] === "*" ? { t: "wild" } : { t: "key", k: m[1] });
      i += 1 + m[1].length;
    } else if (p[i] === "[") {
      let depth = 0;
      let j = i;
      let q: string | null = null;
      for (; j < p.length; j++) {
        const c = p[j];
        if (q) {
          if (c === q && p[j - 1] !== "\\") q = null;
        } else if (c === "'" || c === '"') q = c;
        else if (c === "[") depth++;
        else if (c === "]" && --depth === 0) break;
      }
      const inner = p.slice(i + 1, j).trim();
      i = j + 1;
      if (inner === "*") segs.push({ t: "wild" });
      else if (inner.startsWith("?")) segs.push({ t: "filter", expr: inner.slice(1).trim().replace(/^\(|\)$/g, "") });
      else if (/^-?\d*:-?\d*(:-?\d+)?$/.test(inner)) {
        const [s, e, st] = inner.split(":").map((x) => (x === "" ? undefined : Number(x)));
        segs.push({ t: "slice", s, e, step: st });
      } else {
        const parts = splitTop(inner, ",").map((x) => x.trim());
        const keys = parts.map((x) => (/^-?\d+$/.test(x) ? Number(x) : x.replace(/^['"]|['"]$/g, "")));
        if (keys.length === 1) segs.push(typeof keys[0] === "number" ? { t: "index", i: keys[0] } : { t: "key", k: keys[0] });
        else segs.push({ t: "union", keys });
      }
    } else throw new Error(`Unexpected "${p[i]}" in path`);
  }
  return segs;
}

function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: string | null = null;
  let depth = 0;
  for (const c of s) {
    if (q) {
      if (c === q) q = null;
    } else if (c === "'" || c === '"') q = c;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && c === sep) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function children(v: unknown): [string | number, unknown][] {
  if (Array.isArray(v)) return v.map((x, i) => [i, x]);
  if (v && typeof v === "object") return Object.entries(v as Record<string, unknown>);
  return [];
}

function literal(s: string): unknown {
  const t = s.trim();
  if (/^['"].*['"]$/.test(t)) return t.slice(1, -1);
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return undefined;
}

function operand(node: unknown, s: string): unknown {
  const t = s.trim();
  if (t.startsWith("@")) {
    const r = queryPath(node, `$${t.slice(1)}`);
    return r.length ? r[0].value : undefined;
  }
  return literal(t);
}

/** Evaluate a filter like `@.price < 10 && @.tags`, without eval. */
export function evalFilter(node: unknown, expr: string): boolean {
  const ors = splitLogical(expr, "||");
  if (ors.length > 1) return ors.some((e) => evalFilter(node, e));
  const ands = splitLogical(expr, "&&");
  if (ands.length > 1) return ands.every((e) => evalFilter(node, e));
  let e = expr.trim();
  if (e.startsWith("!")) return !evalFilter(node, e.slice(1));
  if (e.startsWith("(") && e.endsWith(")")) e = e.slice(1, -1);
  const m = /^(.*?)\s*(==|!=|<=|>=|<|>|=~)\s*(.*)$/.exec(e);
  if (!m) {
    const v = operand(node, e);
    return v !== undefined && v !== null && v !== false;
  }
  const a = operand(node, m[1]);
  if (m[2] === "=~") {
    const re = /^\/(.*)\/([a-z]*)$/.exec(m[3].trim());
    return !!re && typeof a === "string" && new RegExp(re[1], re[2]).test(a);
  }
  const b = operand(node, m[3]);
  switch (m[2]) {
    case "==": return a === b;
    case "!=": return a !== b;
    case "<": return (a as number) < (b as number);
    case ">": return (a as number) > (b as number);
    case "<=": return (a as number) <= (b as number);
    default: return (a as number) >= (b as number);
  }
}

function splitLogical(expr: string, op: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let q: string | null = null;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (q) {
      if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"') q = c;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && expr.startsWith(op, i)) {
      out.push(expr.slice(start, i));
      start = i + op.length;
      i += op.length - 1;
    }
  }
  out.push(expr.slice(start));
  return out;
}

export interface PathHit {
  path: string;
  value: unknown;
}

function fmt(path: string, k: string | number): string {
  return typeof k === "number" ? `${path}[${k}]` : /^[A-Za-z_$][\w$]*$/.test(k) ? `${path}.${k}` : `${path}['${k.replace(/'/g, "\\'")}']`;
}

/** Evaluate JSONPath (dot/bracket, *, .., slices, unions, ?() filters). */
export function queryPath(root: unknown, path: string): PathHit[] {
  let cur: PathHit[] = [{ path: "$", value: root }];
  const segs = parsePath(path);
  for (let si = 0; si < segs.length; si++) {
    const s = segs[si];
    const next: PathHit[] = [];
    if (s.t === "desc") {
      const all: PathHit[] = [];
      const walk = (h: PathHit) => {
        all.push(h);
        for (const [k, v] of children(h.value)) walk({ path: fmt(h.path, k), value: v });
      };
      cur.forEach(walk);
      cur = all;
      continue;
    }
    for (const h of cur) {
      const v = h.value;
      if (s.t === "key") {
        if (v && typeof v === "object" && !Array.isArray(v) && s.k in (v as object)) next.push({ path: fmt(h.path, s.k), value: (v as Record<string, unknown>)[s.k] });
        else if (Array.isArray(v) && s.k === "length") next.push({ path: `${h.path}.length`, value: v.length });
      } else if (s.t === "index") {
        if (Array.isArray(v)) {
          const i = s.i < 0 ? v.length + s.i : s.i;
          if (i >= 0 && i < v.length) next.push({ path: fmt(h.path, i), value: v[i] });
        }
      } else if (s.t === "wild") {
        for (const [k, c] of children(v)) next.push({ path: fmt(h.path, k), value: c });
      } else if (s.t === "union") {
        for (const k of s.keys) {
          if (typeof k === "number" && Array.isArray(v) && v[k < 0 ? v.length + k : k] !== undefined) next.push({ path: fmt(h.path, k < 0 ? v.length + k : k), value: v[k < 0 ? v.length + k : k] });
          else if (typeof k === "string" && v && typeof v === "object" && k in (v as object)) next.push({ path: fmt(h.path, k), value: (v as Record<string, unknown>)[k] });
        }
      } else if (s.t === "slice") {
        if (!Array.isArray(v)) continue;
        const n = v.length;
        const step = s.step ?? 1;
        const norm = (x: number | undefined, d: number) => (x === undefined ? d : x < 0 ? Math.max(0, n + x) : Math.min(n, x));
        const start = norm(s.s, step > 0 ? 0 : n - 1);
        const end = norm(s.e, step > 0 ? n : -1);
        if (step > 0) for (let i = start; i < end; i += step) next.push({ path: fmt(h.path, i), value: v[i] });
        else for (let i = start; i > end; i += step) next.push({ path: fmt(h.path, i), value: v[i] });
      } else if (s.t === "filter") {
        for (const [k, c] of children(v)) if (evalFilter(c, s.expr)) next.push({ path: fmt(h.path, k), value: c });
      }
    }
    cur = next;
  }
  return cur;
}

// ── OpenAPI ───────────────────────────────────────────────────────────────

export interface Endpoint {
  method: string;
  path: string;
  summary: string;
  operationId?: string;
  tags: string[];
  params: string[];
  hasBody: boolean;
}

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

/** Endpoints of an OpenAPI 3 / Swagger 2 document. */
export function openApiEndpoints(doc: unknown): Endpoint[] {
  const d = doc as { paths?: Record<string, Record<string, unknown>>; openapi?: string; swagger?: string };
  if (!d || typeof d !== "object" || !d.paths) throw new Error("Not an OpenAPI document (no `paths`)");
  const out: Endpoint[] = [];
  for (const [path, item] of Object.entries(d.paths)) {
    const shared = (item.parameters as { name: string; in: string }[] | undefined) ?? [];
    for (const m of METHODS) {
      const op = item[m] as { summary?: string; description?: string; operationId?: string; tags?: string[]; parameters?: { name: string; in: string }[]; requestBody?: unknown } | undefined;
      if (!op) continue;
      const params = [...shared, ...(op.parameters ?? [])].filter((p) => p && p.name).map((p) => `${p.name} (${p.in})`);
      out.push({
        method: m.toUpperCase(),
        path,
        summary: op.summary ?? op.description?.split("\n")[0] ?? "",
        operationId: op.operationId,
        tags: op.tags ?? [],
        params,
        hasBody: !!op.requestBody || (op.parameters ?? []).some((p) => p.in === "body"),
      });
    }
  }
  return out;
}

/** A curl command for an endpoint against a base URL. */
export function endpointCurl(e: Endpoint, base: string): string {
  const url = `${base.replace(/\/+$/, "")}${e.path.replace(/\{(\w+)\}/g, ":$1")}`;
  const parts = [`curl -X ${e.method} '${url}'`, "-H 'Accept: application/json'"];
  if (e.hasBody) parts.push("-H 'Content-Type: application/json'", "-d '{}'");
  return parts.join(" \\\n  ");
}

/** The server URL declared by a spec (OpenAPI 3 servers[0] or Swagger 2 host). */
export function openApiBase(doc: unknown): string {
  const d = doc as { servers?: { url: string }[]; host?: string; basePath?: string; schemes?: string[] };
  if (d.servers?.[0]?.url) return d.servers[0].url;
  if (d.host) return `${d.schemes?.[0] ?? "https"}://${d.host}${d.basePath ?? ""}`;
  return "http://localhost";
}

// ── linters ───────────────────────────────────────────────────────────────

export interface LintIssue {
  line: number;
  severity: "error" | "warning" | "info";
  rule: string;
  message: string;
}

/** Hadolint-style checks for a Dockerfile. */
export function lintDockerfile(text: string): LintIssue[] {
  const out: LintIssue[] = [];
  // Join continuation lines while remembering where each instruction started.
  const instrs: { line: number; text: string }[] = [];
  let buf = "";
  let start = 0;
  text.split(/\r?\n/).forEach((l, i) => {
    if (!buf && (!l.trim() || l.trim().startsWith("#"))) return;
    if (!buf) start = i + 1;
    buf += `${l.replace(/\\\s*$/, "")} `;
    if (!/\\\s*$/.test(l)) {
      instrs.push({ line: start, text: buf.trim() });
      buf = "";
    }
  });
  if (buf) instrs.push({ line: start, text: buf.trim() });
  let user = "";
  let hasHealth = false;
  let stages = 0;
  for (const { line, text: t } of instrs) {
    const [op, ...rest] = t.split(/\s+/);
    const arg = rest.join(" ");
    const OP = op.toUpperCase();
    if (OP !== op && /^[a-z]+$/.test(op)) out.push({ line, severity: "info", rule: "DL-case", message: `Write instructions in upper case (${OP})` });
    if (OP === "FROM") {
      stages++;
      user = "";
      const image = rest.find((r) => !r.startsWith("--")) ?? "";
      if (image !== "scratch" && !/[:@]/.test(image.replace(/^[^/]*:\d+\//, "")) && !/^\$/.test(image)) out.push({ line, severity: "warning", rule: "DL3006", message: `Pin a tag for ${image} (implicit :latest)` });
      else if (/:latest$/.test(image)) out.push({ line, severity: "warning", rule: "DL3007", message: "Avoid the :latest tag — pin a version" });
    } else if (OP === "RUN") {
      if (/\bapt-get\s+install\b/.test(arg) && !/(-y|--yes|--assume-yes)\b/.test(arg)) out.push({ line, severity: "error", rule: "DL3014", message: "apt-get install without -y will hang" });
      if (/\bapt-get\s+install\b/.test(arg) && !/--no-install-recommends/.test(arg)) out.push({ line, severity: "info", rule: "DL3015", message: "Add --no-install-recommends to keep the image small" });
      if (/\bapt-get\s+install\b/.test(arg) && !/rm -rf \/var\/lib\/apt\/lists/.test(arg)) out.push({ line, severity: "info", rule: "DL3009", message: "Delete /var/lib/apt/lists/* in the same RUN" });
      if (/\bapt-get\s+upgrade\b|\bapt\s+upgrade\b/.test(arg)) out.push({ line, severity: "warning", rule: "DL3005", message: "Don't upgrade packages in a Dockerfile — use a newer base image" });
      if (/\bapk\s+add\b/.test(arg) && !/--no-cache/.test(arg)) out.push({ line, severity: "info", rule: "DL3019", message: "Use apk add --no-cache" });
      if (/\bpip3?\s+install\b/.test(arg) && !/--no-cache-dir/.test(arg)) out.push({ line, severity: "info", rule: "DL3042", message: "Use pip install --no-cache-dir" });
      if (/\bcd\s+\S+/.test(arg)) out.push({ line, severity: "info", rule: "DL3003", message: "Use WORKDIR instead of cd" });
      if (/\bsudo\b/.test(arg)) out.push({ line, severity: "warning", rule: "DL3004", message: "Don't use sudo — set USER instead" });
      if (/(curl|wget)[^|]*\|\s*(ba)?sh\b/.test(arg)) out.push({ line, severity: "warning", rule: "SC-pipe", message: "Piping a download into a shell — verify a checksum first" });
      if (/\bnpm\s+install\b/.test(arg) && !/\bnpm\s+ci\b/.test(arg) && !/-g\b/.test(arg)) out.push({ line, severity: "info", rule: "DL-npm", message: "Prefer npm ci for reproducible installs" });
    } else if (OP === "ADD" && !/^(https?:|.*\.(tar|tgz|tar\.gz|tar\.xz|tar\.bz2)\s)/.test(arg)) {
      out.push({ line, severity: "warning", rule: "DL3020", message: "Use COPY instead of ADD for files and folders" });
    } else if (OP === "USER") user = arg;
    else if (OP === "HEALTHCHECK") hasHealth = true;
    else if (OP === "MAINTAINER") out.push({ line, severity: "warning", rule: "DL4000", message: "MAINTAINER is deprecated — use LABEL maintainer=…" });
    else if ((OP === "CMD" || OP === "ENTRYPOINT") && !arg.startsWith("[")) out.push({ line, severity: "info", rule: "DL3025", message: `Use JSON form for ${OP} so signals reach the process` });
    else if (OP === "ENV" && /(PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY)\w*[=\s]/i.test(arg)) out.push({ line, severity: "error", rule: "SEC-env", message: "Secret baked into the image via ENV — use build secrets or runtime env" });
    else if (OP === "COPY" && /^\.\s+\.?\/?$/.test(arg.trim()) && stages === 1) out.push({ line, severity: "info", rule: "DL-copyall", message: "COPY . . before installing dependencies busts the layer cache — copy the lockfile first" });
  }
  if (instrs.length && (!user || /^(root|0)$/.test(user))) out.push({ line: instrs[instrs.length - 1].line, severity: "warning", rule: "DL3002", message: "The final stage runs as root — add a USER" });
  if (instrs.length && !hasHealth) out.push({ line: 1, severity: "info", rule: "DL-health", message: "No HEALTHCHECK defined" });
  return out.sort((a, b) => a.line - b.line);
}

/** Checks for a GitHub Actions workflow (parsed YAML + raw text for line numbers). */
export function lintWorkflow(doc: unknown, text: string): LintIssue[] {
  const out: LintIssue[] = [];
  const lines = text.split(/\r?\n/);
  const lineOf = (re: RegExp, from = 0) => {
    for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
    return 1;
  };
  const w = doc as { on?: unknown; true?: unknown; jobs?: Record<string, Record<string, unknown>>; permissions?: unknown };
  if (!w || typeof w !== "object") throw new Error("Not a YAML mapping");
  if (!("on" in w) && !("true" in w)) out.push({ line: 1, severity: "error", rule: "on", message: "Missing `on:` trigger" });
  if (!w.jobs) out.push({ line: 1, severity: "error", rule: "jobs", message: "Missing `jobs:`" });
  if (!w.permissions) out.push({ line: 1, severity: "info", rule: "permissions", message: "No top-level `permissions:` — the token gets the repo default (often write-all)" });
  const triggers = JSON.stringify(w.on ?? w.true ?? "");
  const prTarget = triggers.includes("pull_request_target");
  lines.forEach((l, i) => {
    const uses = /^\s*-?\s*uses:\s*['"]?([^'"\s#]+)/.exec(l);
    if (uses && !uses[1].startsWith("./") && !uses[1].startsWith("docker://")) {
      const ref = uses[1].split("@")[1];
      if (!ref) out.push({ line: i + 1, severity: "error", rule: "uses-ref", message: `${uses[1]} has no version` });
      else if (/^(main|master|HEAD|latest)$/.test(ref)) out.push({ line: i + 1, severity: "warning", rule: "uses-branch", message: `${uses[1]} tracks a branch — pin a tag or SHA` });
      else if (!/^[0-9a-f]{40}$/.test(ref) && !uses[1].startsWith("actions/") && !uses[1].startsWith("github/")) out.push({ line: i + 1, severity: "info", rule: "uses-sha", message: `Pin third-party ${uses[1].split("@")[0]} to a commit SHA` });
      const old = /^actions\/(checkout|setup-node|setup-python|cache|upload-artifact|download-artifact)@v([0-9]+)/.exec(uses[1]);
      const latest: Record<string, number> = { checkout: 4, "setup-node": 4, "setup-python": 5, cache: 4, "upload-artifact": 4, "download-artifact": 4 };
      if (old && Number(old[2]) < latest[old[1]]) out.push({ line: i + 1, severity: "warning", rule: "uses-old", message: `actions/${old[1]}@v${old[2]} is outdated (v${latest[old[1]]})` });
    }
    if (/::set-output\b|::save-state\b/.test(l)) out.push({ line: i + 1, severity: "warning", rule: "set-output", message: "::set-output is deprecated — write to $GITHUB_OUTPUT" });
    if (/::set-env\b|::add-path\b/.test(l)) out.push({ line: i + 1, severity: "error", rule: "set-env", message: "::set-env/::add-path are disabled — use $GITHUB_ENV / $GITHUB_PATH" });
    if (/run:.*\$\{\{\s*github\.event\.(issue|pull_request|comment|review|head_commit)\.[\w.]*(title|body|message|head_ref|label)/.test(l) || (/^\s+.*\$\{\{\s*github\.(head_ref|event\.\w+\.(title|body))/.test(l) && /run/.test(lines.slice(Math.max(0, i - 5), i + 1).join("\n")))) {
      out.push({ line: i + 1, severity: "error", rule: "injection", message: "Untrusted event text interpolated into a script — pass it through env: instead" });
    }
  });
  for (const [name, job] of Object.entries(w.jobs ?? {})) {
    const at = lineOf(new RegExp(`^\\s{2}${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`));
    if (!job["runs-on"] && !job.uses) out.push({ line: at, severity: "error", rule: "runs-on", message: `Job "${name}" has no runs-on` });
    if (!job["timeout-minutes"] && !job.uses) out.push({ line: at, severity: "info", rule: "timeout", message: `Job "${name}" has no timeout-minutes (default 6 hours)` });
    const needs = ([] as string[]).concat((job.needs as string | string[] | undefined) ?? []);
    for (const n of needs) if (!w.jobs?.[n]) out.push({ line: at, severity: "error", rule: "needs", message: `Job "${name}" needs unknown job "${n}"` });
    if (prTarget && JSON.stringify(job.steps ?? []).includes("github.event.pull_request.head")) out.push({ line: at, severity: "error", rule: "pwn-request", message: `pull_request_target checks out PR code in "${name}" — untrusted code with secrets` });
  }
  return out.sort((a, b) => a.line - b.line);
}

/** Checks for Kubernetes manifests (one or more parsed documents). */
export function lintK8s(docs: unknown[], text: string): LintIssue[] {
  const out: LintIssue[] = [];
  const lines = text.split(/\r?\n/);
  const lineOf = (needle: string) => Math.max(1, lines.findIndex((l) => l.includes(needle)) + 1);
  for (const d of docs) {
    const o = d as { kind?: string; metadata?: { name?: string; namespace?: string }; spec?: Record<string, unknown> };
    if (!o?.kind) continue;
    const name = `${o.kind}/${o.metadata?.name ?? "?"}`;
    const podSpec = (["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job"].includes(o.kind)
      ? (o.spec?.template as { spec?: Record<string, unknown> } | undefined)?.spec
      : o.kind === "CronJob"
        ? ((o.spec?.jobTemplate as { spec?: { template?: { spec?: Record<string, unknown> } } } | undefined)?.spec?.template?.spec)
        : o.kind === "Pod" ? o.spec : undefined) as { containers?: Record<string, unknown>[]; hostNetwork?: boolean; securityContext?: Record<string, unknown> } | undefined;
    if (o.kind === "Deployment" && (o.spec?.replicas as number | undefined) === 1) out.push({ line: lineOf("replicas"), severity: "info", rule: "replicas", message: `${name}: a single replica has no redundancy` });
    if (!podSpec) continue;
    if (podSpec.hostNetwork) out.push({ line: lineOf("hostNetwork"), severity: "warning", rule: "hostNetwork", message: `${name}: hostNetwork exposes the node network` });
    for (const c of podSpec.containers ?? []) {
      const cn = `${name} › ${String(c.name ?? "?")}`;
      const at = lineOf(`name: ${String(c.name)}`);
      const image = String(c.image ?? "");
      if (!image.includes(":") || image.endsWith(":latest")) out.push({ line: lineOf(image) || at, severity: "warning", rule: "image-tag", message: `${cn}: pin an image tag (not :latest)` });
      const res = c.resources as { limits?: Record<string, unknown>; requests?: Record<string, unknown> } | undefined;
      if (!res?.limits?.memory) out.push({ line: at, severity: "warning", rule: "limits", message: `${cn}: no memory limit` });
      if (!res?.requests?.cpu) out.push({ line: at, severity: "info", rule: "requests", message: `${cn}: no CPU request` });
      if (!c.readinessProbe) out.push({ line: at, severity: "info", rule: "readiness", message: `${cn}: no readinessProbe` });
      if (!c.livenessProbe) out.push({ line: at, severity: "info", rule: "liveness", message: `${cn}: no livenessProbe` });
      const sc = { ...(podSpec.securityContext ?? {}), ...((c.securityContext as Record<string, unknown>) ?? {}) };
      if (sc.privileged) out.push({ line: lineOf("privileged"), severity: "error", rule: "privileged", message: `${cn}: privileged container` });
      if (sc.runAsNonRoot !== true && !(typeof sc.runAsUser === "number" && sc.runAsUser > 0)) out.push({ line: at, severity: "warning", rule: "root", message: `${cn}: may run as root (set runAsNonRoot: true)` });
      if (sc.allowPrivilegeEscalation !== false) out.push({ line: at, severity: "info", rule: "escalation", message: `${cn}: set allowPrivilegeEscalation: false` });
      if (sc.readOnlyRootFilesystem !== true) out.push({ line: at, severity: "info", rule: "readonly-fs", message: `${cn}: consider readOnlyRootFilesystem: true` });
      for (const e of (c.env as { name: string; value?: string }[] | undefined) ?? []) {
        if (/PASSWORD|SECRET|TOKEN|API_KEY/i.test(e.name) && typeof e.value === "string" && e.value) out.push({ line: lineOf(e.name), severity: "error", rule: "secret-env", message: `${cn}: ${e.name} is a literal — use a Secret (valueFrom.secretKeyRef)` });
      }
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

/** Split a multi-document YAML stream on `---` lines. */
export function splitYamlDocs(text: string): string[] {
  return text.split(/^---[ \t]*$/m).filter((d) => d.trim());
}

// ── CSV ───────────────────────────────────────────────────────────────────

export interface ColumnStats {
  name: string;
  type: "number" | "integer" | "boolean" | "date" | "text" | "empty";
  count: number;
  empty: number;
  unique: number;
  min?: string;
  max?: string;
  mean?: number;
  median?: number;
  top: [string, number][];
}

export function detectDelimiter(text: string): string {
  const first = text.split("\n", 1)[0];
  const counts = [",", "\t", ";", "|"].map((d) => [d, first.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

/** Per-column statistics for a CSV/TSV with a header row. */
export function csvColumnStats(text: string): ColumnStats[] {
  const rows = parseCsv(text, { delimiter: detectDelimiter(text) }).filter((r) => r.some((c) => c !== ""));
  if (!rows.length) return [];
  const [head, ...body] = rows;
  return head.map((name, i) => {
    const vals = body.map((r) => (r[i] ?? "").trim());
    const filled = vals.filter((v) => v !== "");
    const freq = new Map<string, number>();
    for (const v of filled) freq.set(v, (freq.get(v) ?? 0) + 1);
    const nums = filled.map((v) => Number(v.replace(/[,_](?=\d{3}\b)/g, "")));
    const allNum = filled.length > 0 && nums.every((n) => Number.isFinite(n));
    const allBool = filled.length > 0 && filled.every((v) => /^(true|false|yes|no|0|1)$/i.test(v)) && !allNum;
    const allDate = filled.length > 0 && !allNum && filled.every((v) => /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v)));
    const type: ColumnStats["type"] = !filled.length ? "empty" : allNum ? (nums.every(Number.isInteger) ? "integer" : "number") : allBool ? "boolean" : allDate ? "date" : "text";
    const s: ColumnStats = { name, type, count: vals.length, empty: vals.length - filled.length, unique: freq.size, top: [...freq].sort((a, b) => b[1] - a[1]).slice(0, 3) };
    if (allNum) {
      const sorted = [...nums].sort((a, b) => a - b);
      s.min = String(sorted[0]);
      s.max = String(sorted[sorted.length - 1]);
      s.mean = Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1000) / 1000;
      const mid = sorted.length >> 1;
      s.median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    } else if (filled.length) {
      const sorted = [...filled].sort();
      s.min = sorted[0];
      s.max = sorted[sorted.length - 1];
    }
    return s;
  });
}

export function renderStats(stats: ColumnStats[]): string {
  const rows = stats.map((s) => [s.name, s.type, String(s.count), String(s.empty), String(s.unique), s.min ?? "", s.max ?? "", s.mean?.toString() ?? "", s.median?.toString() ?? "", s.top.map(([v, n]) => `${v} (${n})`).join(", ")]);
  return `${renderMarkdown(["Column", "Type", "Rows", "Empty", "Unique", "Min", "Max", "Mean", "Median", "Most common"], [], rows)}\n`;
}

function withEol(out: string, original: string): string {
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const body = out.replace(/\r?\n$/, "");
  return /\n$/.test(original) ? body + eol : body;
}

/** Keep rows matching `col op value` conditions joined by and/or (header kept). */
export function csvFilter(text: string, expr: string): { text: string; kept: number; total: number } {
  const delimiter = detectDelimiter(text);
  const rows = parseCsv(text, { delimiter }).filter((r) => r.some((c) => c !== ""));
  if (!rows.length) return { text, kept: 0, total: 0 };
  const [head, ...body] = rows;
  const col = (name: string) => {
    const n = name.trim().replace(/^["'`]|["'`]$/g, "");
    const i = head.findIndex((h) => h.trim().toLowerCase() === n.toLowerCase());
    if (i < 0) throw new Error(`No column "${n}"`);
    return i;
  };
  const test = (row: string[], cond: string): boolean => {
    const m = /^\s*(.+?)\s*(==|!=|>=|<=|>|<|=|~|!~|contains|startswith|endswith|empty|notempty)\s*(.*?)\s*$/i.exec(cond);
    if (!m) throw new Error(`Can't read condition "${cond.trim()}"`);
    const cell = (row[col(m[1])] ?? "").trim();
    const raw = m[3].replace(/^["']|["']$/g, "");
    const op = m[2].toLowerCase();
    const bothNum = cell !== "" && raw !== "" && Number.isFinite(Number(cell)) && Number.isFinite(Number(raw));
    const cmp = bothNum ? Number(cell) - Number(raw) : cell.localeCompare(raw);
    switch (op) {
      case "=": case "==": return bothNum ? cmp === 0 : cell.toLowerCase() === raw.toLowerCase();
      case "!=": return bothNum ? cmp !== 0 : cell.toLowerCase() !== raw.toLowerCase();
      case ">": return cmp > 0;
      case "<": return cmp < 0;
      case ">=": return cmp >= 0;
      case "<=": return cmp <= 0;
      case "~": return new RegExp(raw, "i").test(cell);
      case "!~": return !new RegExp(raw, "i").test(cell);
      case "contains": return cell.toLowerCase().includes(raw.toLowerCase());
      case "startswith": return cell.toLowerCase().startsWith(raw.toLowerCase());
      case "endswith": return cell.toLowerCase().endsWith(raw.toLowerCase());
      case "empty": return cell === "";
      default: return cell !== "";
    }
  };
  const ors = expr.split(/\s+(?:or|\|\|)\s+/i);
  const kept = body.filter((r) => ors.some((o) => o.split(/\s+(?:and|&&)\s+/i).every((c) => test(r, c))));
  return { text: withEol(stringifyCsv([head, ...kept], { delimiter }), text), kept: kept.length, total: body.length };
}

/** Sort CSV rows by a column (numeric when every value is a number). */
export function csvSort(text: string, column: string, desc = false): string {
  const delimiter = detectDelimiter(text);
  const rows = parseCsv(text, { delimiter }).filter((r) => r.some((c) => c !== ""));
  const [head, ...body] = rows;
  const i = head.findIndex((h) => h.trim().toLowerCase() === column.trim().toLowerCase());
  if (i < 0) throw new Error(`No column "${column}"`);
  const numeric = body.every((r) => (r[i] ?? "").trim() === "" || Number.isFinite(Number(r[i])));
  const sorted = [...body].sort((a, b) => {
    const x = (a[i] ?? "").trim();
    const y = (b[i] ?? "").trim();
    // Empty cells always sink to the bottom.
    if (x === "" || y === "") return x === y ? 0 : x === "" ? 1 : -1;
    const c = numeric ? Number(x) - Number(y) : x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
    return desc ? -c : c;
  });
  return withEol(stringifyCsv([head, ...sorted], { delimiter }), text);
}

// ── Markdown tables ───────────────────────────────────────────────────────

interface MdTable {
  header: string[];
  aligns: Align[];
  rows: string[][];
  indent: string;
}

function readTable(text: string): MdTable {
  const lines = text.split("\n").filter((l) => l.trim());
  const cells = lines.map(splitRow);
  if (cells.length < 2 || !isSeparatorRow(cells[1])) throw new Error("Put the cursor inside a Markdown table");
  return { header: cells[0], aligns: cells[1].map(alignOf), rows: cells.slice(2), indent: /^\s*/.exec(lines[0])![0] };
}

/** The table's line range around `lineIdx` (0-based) in `lines`. */
export function tableBounds(lines: string[], lineIdx: number): { start: number; end: number } | null {
  const isRow = (l: string | undefined) => l !== undefined && /^\s*\|.*\|\s*$|^[^|]*\|[^|]*/.test(l) && l.trim() !== "";
  if (!isRow(lines[lineIdx])) return null;
  let start = lineIdx;
  let end = lineIdx;
  while (isRow(lines[start - 1])) start--;
  while (isRow(lines[end + 1])) end++;
  if (end - start < 1 || !isSeparatorRow(splitRow(lines[start + 1]))) return null;
  return { start, end };
}

/** Column index of a cursor column within a table row. */
export function columnAt(line: string, col: number): number {
  let n = -1;
  let inCode = false;
  const trimmedStart = line.indexOf("|") === line.search(/\S/);
  for (let i = 0; i < Math.min(col, line.length); i++) {
    if (line[i] === "`") inCode = !inCode;
    if (line[i] === "|" && line[i - 1] !== "\\" && !inCode) n++;
  }
  return Math.max(0, trimmedStart ? n : n + 1);
}

export type TableOp = "insertLeft" | "insertRight" | "delete" | "moveLeft" | "moveRight" | "sortAsc" | "sortDesc" | "addRow";

export function editTable(text: string, column: number, op: TableOp): string {
  const t = readTable(text);
  const cols = Math.max(t.header.length, ...t.rows.map((r) => r.length));
  const pad = (r: string[]) => Array.from({ length: cols }, (_, i) => r[i] ?? "");
  let header = pad(t.header);
  let aligns: Align[] = Array.from({ length: cols }, (_, i) => t.aligns[i] ?? "none");
  let rows = t.rows.map(pad);
  const c = Math.min(column, cols - 1);
  const each = <T,>(f: (r: T[]) => T[]) => f;
  const insertAt = (i: number) => {
    header = each<string>((r) => [...r.slice(0, i), "", ...r.slice(i)])(header);
    aligns = [...aligns.slice(0, i), "none", ...aligns.slice(i)];
    rows = rows.map((r) => [...r.slice(0, i), "", ...r.slice(i)]);
  };
  const swap = (a: number, b: number) => {
    if (b < 0 || b >= cols) return;
    const sw = <T,>(r: T[]) => {
      const x = [...r];
      [x[a], x[b]] = [x[b], x[a]];
      return x;
    };
    header = sw(header);
    aligns = sw(aligns);
    rows = rows.map(sw);
  };
  switch (op) {
    case "insertLeft": insertAt(c); break;
    case "insertRight": insertAt(c + 1); break;
    case "delete":
      if (cols <= 1) throw new Error("Can't delete the only column");
      header = header.filter((_, i) => i !== c);
      aligns = aligns.filter((_, i) => i !== c);
      rows = rows.map((r) => r.filter((_, i) => i !== c));
      break;
    case "moveLeft": swap(c, c - 1); break;
    case "moveRight": swap(c, c + 1); break;
    case "addRow": rows = [...rows, Array.from({ length: cols }, () => "")]; break;
    default: {
      const numeric = rows.every((r) => r[c].trim() === "" || Number.isFinite(Number(r[c].replace(/[$,%]/g, ""))));
      rows = [...rows].sort((a, b) => {
        const x = a[c].trim();
        const y = b[c].trim();
        const d = numeric ? Number(x.replace(/[$,%]/g, "") || 0) - Number(y.replace(/[$,%]/g, "") || 0) : x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
        return op === "sortDesc" ? -d : d;
      });
    }
  }
  return renderMarkdown(header, aligns, rows, t.indent);
}

// ── code helpers ──────────────────────────────────────────────────────────

/** Re-indent pasted text so its least-indented line lands at `indent`. */
export function reindentPaste(text: string, indent: string, firstLineAlreadyIndented = true): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const tabWidth = 4;
  const widthOf = (s: string) => s.replace(/\t/g, " ".repeat(tabWidth)).length;
  // The first line often comes without its original indentation, so ignore it when measuring.
  const sample = lines.length > 1 ? lines.slice(1) : lines;
  const min = Math.min(...sample.filter((l) => l.trim()).map((l) => widthOf(/^[ \t]*/.exec(l)![0])));
  const base = Number.isFinite(min) ? min : 0;
  const unit = indent.includes("\t") ? "\t" : " ";
  const out = lines.map((l, i) => {
    if (!l.trim()) return "";
    const w = widthOf(/^[ \t]*/.exec(l)![0]);
    const rest = l.trimStart();
    if (i === 0 && firstLineAlreadyIndented) return rest;
    const extra = Math.max(0, w - base);
    return indent + (unit === "\t" ? "\t".repeat(Math.round(extra / tabWidth)) : " ".repeat(extra)) + rest;
  });
  return out.join("\n");
}

/** `export * from "./x"` lines for the modules in a folder. */
export function barrelFor(files: string[], style: "star" | "named" = "star", namesByFile: Record<string, string[]> = {}): string {
  const mods = files
    .map((f) => f.replace(/\\/g, "/").replace(/^.*\//, ""))
    .filter((f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f) && !/^index\.|\.(test|spec|stories|d)\.[a-z]+$/.test(f))
    .map((f) => f.replace(/\.(ts|tsx|js|jsx|mjs)$/, ""))
    .sort();
  return `${mods
    .map((m) => {
      const names = namesByFile[m];
      return style === "named" && names?.length ? `export { ${names.join(", ")} } from "./${m}";` : `export * from "./${m}";`;
    })
    .join("\n")}\n`;
}

/** Convert `function f(a) { … }` ⇄ `const f = (a) => { … };` for the declaration in `text`. */
export function toggleArrow(text: string): string {
  const fn = /^(\s*)(export\s+(?:default\s+)?)?(async\s+)?function\s*([A-Za-z_$][\w$]*)\s*(<[^>]*>)?\s*\(([\s\S]*?)\)\s*(:\s*[^{]+?)?\s*\{([\s\S]*)\}\s*;?\s*$/.exec(text);
  if (fn) {
    const [, ind, exp = "", asy = "", name, generics = "", params, ret = "", body] = fn;
    const exported = exp.includes("default") ? "export " : exp;
    const one = /^\s*return\s+([^;\n]+);?\s*$/.exec(body);
    const arrowBody = one && !/^\s*\{/.test(one[1]) ? ` ${one[1].trim()}` : ` {${body}}`;
    return `${ind}${exported}const ${name} = ${asy}${generics}(${params})${ret.trim() ? ret.trim().replace(/^:\s*/, ": ") : ""} =>${arrowBody};`;
  }
  const ar = /^(\s*)(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+?)?=\s*(async\s+)?(<[^>]*>)?\s*(?:\(([\s\S]*?)\)|([A-Za-z_$][\w$]*))\s*(:\s*[^=]+?)?\s*=>\s*([\s\S]*?);?\s*$/.exec(text);
  if (ar) {
    const [, ind, exp = "", name, asy = "", generics = "", params, single, ret = "", rawBody] = ar;
    const body = rawBody.trim();
    const block = body.startsWith("{") ? body.slice(1, body.lastIndexOf("}")) : `\n${ind}  return ${body.replace(/^\(([\s\S]*)\)$/, "$1")};\n${ind}`;
    return `${ind}${exp}${asy}function ${name}${generics}(${params ?? single})${ret.trim() ? ret.trim().replace(/^:\s*/, ": ") : ""} {${block}}`;
  }
  throw new Error("Put the cursor in a function declaration or an arrow-function const");
}

/** Duplicate keys in a JSON object or YAML mapping (by indentation level). */
export function duplicateKeys(text: string, yaml: boolean): { key: string; line: number; first: number }[] {
  const out: { key: string; line: number; first: number }[] = [];
  const lines = text.split(/\r?\n/);
  if (yaml) {
    // Track keys per (indent, parent block).
    const stack: { indent: number; keys: Map<string, number> }[] = [{ indent: -1, keys: new Map() }];
    lines.forEach((l, i) => {
      if (!l.trim() || /^\s*#/.test(l) || /^---/.test(l)) {
        if (/^---/.test(l)) stack.splice(0, stack.length, { indent: -1, keys: new Map() });
        return;
      }
      const m = /^(\s*)(- )?(["']?)([^"':#][^:#]*?)\3\s*:(\s|$)/.exec(l);
      const ind = /^\s*/.exec(l)![0].length + (m?.[2] ? 2 : 0);
      if (/^\s*- /.test(l)) {
        // A new list item starts a fresh mapping at its indent.
        while (stack.length > 1 && stack[stack.length - 1].indent >= ind) stack.pop();
        stack.push({ indent: ind, keys: new Map() });
      }
      while (stack.length > 1 && stack[stack.length - 1].indent > ind) stack.pop();
      if (stack[stack.length - 1].indent < ind) stack.push({ indent: ind, keys: new Map() });
      if (!m) return;
      const k = m[4].trim();
      const seen = stack[stack.length - 1].keys;
      if (seen.has(k)) out.push({ key: k, line: i + 1, first: seen.get(k)! });
      else seen.set(k, i + 1);
    });
    return out;
  }
  const objStack: Map<string, number>[] = [];
  const kinds: ("{" | "[")[] = [];
  let line = 1;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\n") line++;
    if (c === "{" || c === "[") {
      kinds.push(c);
      if (c === "{") objStack.push(new Map());
    } else if (c === "}" || c === "]") {
      if (kinds.pop() === "{") objStack.pop();
    } else if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      const s = text.slice(i + 1, j);
      let k = j + 1;
      while (/\s/.test(text[k] ?? "")) k++;
      if (text[k] === ":" && kinds[kinds.length - 1] === "{") {
        const seen = objStack[objStack.length - 1];
        if (seen.has(s)) out.push({ key: s, line, first: seen.get(s)! });
        else seen.set(s, line);
      }
      i = j;
    }
    i++;
  }
  return out;
}
