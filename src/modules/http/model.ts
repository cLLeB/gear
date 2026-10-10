// HTTP client model for .http / .rest files (JetBrains HTTP Client / VS Code
// REST Client syntax): parsing requests with their ranges and scripts,
// variables (file, environment, dynamic, globals, earlier responses via
// {{name.response.body.$.path}}), the curl config that sends a request (no
// shell quoting involved), and parsers for what curl writes back.

export interface ParsedRequest {
  index: number;
  name: string | null;
  /** 0-based line of the request line ("POST https://…"). */
  line: number;
  startLine: number;
  endLine: number;
  method: string;
  url: string;
  headers: [string, string][];
  body: string | null;
  /** `< ./file.json` as the whole body. */
  bodyFile: string | null;
  preScript: string | null;
  script: string | null;
  /** `# @no-redirect`, `# @no-cookie-jar`, `# @timeout 5` … */
  directives: Record<string, string>;
}

export interface HttpFile {
  vars: Record<string, string>;
  requests: ParsedRequest[];
}

const METHOD = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\s+(\S+)(?:\s+HTTP\/[\d.]+)?\s*$/i;
const URL_ONLY = /^(https?:\/\/\S+|\{\{[^}]+\}\}\S*)\s*$/i;

/** Parse a whole .http file. Variables keep their raw text; substitution happens at send time. */
export function parseHttpFile(text: string): HttpFile {
  const lines = text.split(/\r?\n/);
  const vars: Record<string, string> = {};
  const requests: ParsedRequest[] = [];
  // Blocks are separated by lines starting with ###.
  const blocks: { start: number; end: number; title: string | null }[] = [];
  let start = 0;
  let title: string | null = null;
  for (let i = 0; i <= lines.length; i++) {
    if (i === lines.length || /^###/.test(lines[i])) {
      blocks.push({ start, end: i, title });
      if (i < lines.length) {
        start = i + 1;
        title = lines[i].replace(/^###\s*/, "").trim() || null;
      }
    }
  }
  for (const b of blocks) {
    let i = b.start;
    let name = b.title;
    const directives: Record<string, string> = {};
    let preScript: string | null = null;
    // Leading comments, variables, directives and pre-request scripts.
    while (i < b.end) {
      const l = lines[i];
      const v = /^\s*@([\w.-]+)\s*=\s*(.*?)\s*$/.exec(l);
      const d = /^\s*(?:#|\/\/)\s*@([\w-]+)(?:\s+(.*?))?\s*$/.exec(l);
      if (v) vars[v[1]] = v[2];
      else if (d) {
        if (d[1] === "name") name = d[2] ?? name;
        else directives[d[1]] = d[2] ?? "";
      } else if (/^<\s*\{%/.test(l)) {
        const s = readScript(lines, i, b.end);
        preScript = s.text;
        i = s.next;
        continue;
      } else if (!/^\s*$/.test(l) && !/^\s*(#|\/\/)/.test(l)) break;
      i++;
    }
    if (i >= b.end) continue;
    const reqLine = lines[i].trim();
    const m = METHOD.exec(reqLine);
    if (!m && !URL_ONLY.test(reqLine)) continue;
    const line = i;
    let url = m ? m[2] : reqLine.split(/\s+/)[0];
    i++;
    while (i < b.end && /^\s+[?&]/.test(lines[i])) url += lines[i].trim(), i++;
    const headers: [string, string][] = [];
    while (i < b.end && lines[i].trim() !== "") {
      const l = lines[i];
      if (/^\s*(#|\/\/)/.test(l)) {
        i++;
        continue;
      }
      if (/^>\s*\{%|^<\s*\{%/.test(l)) break;
      const h = /^([^:\s][^:]*):\s?(.*)$/.exec(l.trim());
      if (h) headers.push([h[1].trim(), h[2].trim()]);
      i++;
    }
    // Body: up to a response handler / output redirect / end of block.
    const body: string[] = [];
    let script: string | null = null;
    while (i < b.end) {
      const l = lines[i];
      if (/^>\s*\{%/.test(l)) {
        const s = readScript(lines, i, b.end);
        script = s.text;
        i = s.next;
        continue;
      }
      if (/^>>!?\s/.test(l) || /^>\s+\S+\.js\s*$/.test(l)) {
        i++;
        continue;
      }
      if (script === null) body.push(l);
      i++;
    }
    while (body.length && body[0].trim() === "") body.shift();
    while (body.length && body[body.length - 1].trim() === "") body.pop();
    const fileRef = body.length === 1 ? /^<\s+(\S.*)$/.exec(body[0].trim()) : null;
    requests.push({
      index: requests.length,
      name,
      line,
      startLine: b.start,
      endLine: b.end,
      method: m ? m[1].toUpperCase() : "GET",
      url,
      headers,
      body: fileRef || !body.length ? null : body.join("\n"),
      bodyFile: fileRef ? fileRef[1] : null,
      preScript,
      script,
      directives,
    });
  }
  return { vars, requests };
}

function readScript(lines: string[], from: number, end: number): { text: string; next: number } {
  const first = lines[from].replace(/^[<>]\s*\{%/, "");
  const close = first.indexOf("%}");
  if (close >= 0) return { text: first.slice(0, close).trim(), next: from + 1 };
  const out = [first];
  for (let i = from + 1; i < end; i++) {
    const c = lines[i].indexOf("%}");
    if (c >= 0) {
      out.push(lines[i].slice(0, c));
      return { text: out.join("\n").trim(), next: i + 1 };
    }
    out.push(lines[i]);
  }
  return { text: out.join("\n").trim(), next: end };
}

export function requestAtLine(file: HttpFile, line: number): ParsedRequest | null {
  return file.requests.find((r) => line >= r.startLine && line < r.endLine) ?? null;
}

// ── variables ─────────────────────────────────────────────────────────────

export interface StoredResponse {
  status: number;
  headers: [string, string][];
  body: string;
}

export interface VarContext {
  file: Record<string, string>;
  env: Record<string, string>;
  globals: Record<string, string>;
  /** Variables set by the request's pre-request script. */
  request?: Record<string, string>;
  responses: Record<string, StoredResponse>;
  now?: () => Date;
  random?: () => number;
}

/** A small JSONPath: $.a.b[0]['c d'].e, $..x not supported. */
export function jsonPath(value: unknown, path: string): unknown {
  const p = path.trim().replace(/^\$/, "");
  const re = /\.([A-Za-z_$][\w$-]*)|\[(\d+)\]|\[['"]([^'"]+)['"]\]|\[\*\]/g;
  let cur: unknown = value;
  let last = 0;
  for (const m of p.matchAll(re)) {
    if (m.index !== last) return undefined;
    last = m.index! + m[0].length;
    if (cur === null || cur === undefined) return undefined;
    if (m[0] === "[*]") continue;
    const key = m[1] ?? m[3] ?? Number(m[2]);
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return last === p.length ? cur : undefined;
}

function uuid(random: () => number): string {
  const h = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16));
  h[12] = "4";
  h[16] = ((parseInt(h[16], 16) & 3) | 8).toString(16);
  return `${h.slice(0, 8).join("")}-${h.slice(8, 12).join("")}-${h.slice(12, 16).join("")}-${h.slice(16, 20).join("")}-${h.slice(20).join("")}`;
}

function dynamic(name: string, args: string[], ctx: VarContext): string | undefined {
  const now = ctx.now?.() ?? new Date();
  const random = ctx.random ?? Math.random;
  switch (name) {
    case "$uuid":
    case "$random.uuid":
    case "$guid":
      return uuid(random);
    case "$timestamp":
      return String(Math.floor(now.getTime() / 1000));
    case "$isoTimestamp":
      return now.toISOString();
    case "$randomInt": {
      const [min, max] = args.length === 2 ? args.map(Number) : [0, 1000];
      return String(Math.floor(min + random() * (max - min)));
    }
    case "$random.integer": {
      const [min, max] = args.length === 2 ? args.map(Number) : [0, 1000];
      return String(Math.floor(min + random() * (max - min)));
    }
    case "$random.alphabetic":
    case "$random.alphanumeric": {
      const n = Number(args[0]) || 8;
      const chars = name === "$random.alphabetic" ? "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ" : "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      return Array.from({ length: n }, () => chars[Math.floor(random() * chars.length)]).join("");
    }
    case "$random.email":
      return `user${Math.floor(random() * 1e6)}@example.com`;
    case "$processEnv":
    case "$dotenv":
      return undefined;
  }
  return undefined;
}

function responseValue(ref: string, ctx: VarContext): string | undefined {
  // name.response.body.$.path | name.response.body.* | name.response.headers.X
  const m = /^([\w-]+)\.response\.(body|headers)(?:\.(.*))?$/.exec(ref);
  if (!m) return undefined;
  const r = ctx.responses[m[1]];
  if (!r) return undefined;
  if (m[2] === "headers") {
    const name = (m[3] ?? "").toLowerCase();
    return r.headers.find(([k]) => k.toLowerCase() === name)?.[1];
  }
  const path = m[3] ?? "*";
  if (path === "*") return r.body;
  if (path.startsWith("$")) {
    try {
      const v = jsonPath(JSON.parse(r.body), path);
      return v === undefined ? undefined : typeof v === "string" ? v : JSON.stringify(v);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Substitute {{…}}; returns the text and the names that couldn't be resolved. */
export function resolve(text: string, ctx: VarContext): { text: string; missing: string[] } {
  const missing: string[] = [];
  const lookup = (raw: string, depth: number): string | undefined => {
    const [name, ...args] = raw.trim().split(/\s+/);
    if (name.startsWith("$")) return dynamic(name, args, ctx);
    const v = ctx.request?.[name] ?? ctx.globals[name] ?? ctx.env[name] ?? ctx.file[name] ?? responseValue(name, ctx);
    // Variables may reference other variables.
    return v === undefined ? undefined : depth < 5 ? expand(v, depth + 1) : v;
  };
  const expand = (s: string, depth: number): string =>
    s.replace(/\{\{([^{}]+)\}\}/g, (all, raw: string) => {
      const v = lookup(raw, depth);
      if (v === undefined) {
        if (!missing.includes(raw.trim())) missing.push(raw.trim());
        return all;
      }
      return v;
    });
  return { text: expand(text, 0), missing };
}

export interface ResolvedRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body: string | null;
  bodyFile: string | null;
  missing: string[];
}

export function resolveRequest(r: ParsedRequest, ctx: VarContext): ResolvedRequest {
  const missing = new Set<string>();
  const res = (s: string) => {
    const x = resolve(s, ctx);
    x.missing.forEach((m) => missing.add(m));
    return x.text;
  };
  return {
    method: r.method,
    url: res(r.url),
    headers: r.headers.map(([k, v]) => [res(k), res(v)] as [string, string]),
    body: r.body === null ? null : res(r.body),
    bodyFile: r.bodyFile === null ? null : res(r.bodyFile),
    missing: [...missing],
  };
}

/** Environments: http-client.env.json merged with http-client.private.env.json. */
export function parseEnvironments(publicJson: string | null, privateJson: string | null): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const src of [publicJson, privateJson]) {
    if (!src) continue;
    const parsed = JSON.parse(src) as Record<string, Record<string, unknown>>;
    for (const [env, vars] of Object.entries(parsed)) {
      if (!vars || typeof vars !== "object") continue;
      out[env] = { ...(out[env] ?? {}), ...Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])) };
    }
  }
  return out;
}

// ── curl ──────────────────────────────────────────────────────────────────

/** A value in a curl config file. */
export function curlQuote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\t/g, "\\t").replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`;
}

export const WRITE_OUT_FIELDS = ["http_code", "http_version", "time_namelookup", "time_connect", "time_appconnect", "time_pretransfer", "time_starttransfer", "time_total", "size_download", "size_upload", "num_redirects", "remote_ip", "url_effective", "content_type"] as const;

export interface CurlFiles {
  body: string | null;
  out: string;
  headers: string;
}

export interface SendOptions {
  followRedirects: boolean;
  insecure: boolean;
  timeoutSecs: number;
  cookieJar: string | null;
}

/** Percent-encode what isn't legal in a URL (spaces, quotes, non-ASCII…), keeping existing %XX escapes. */
export function encodeUrl(url: string): string {
  return url.trim().replace(/%(?![0-9A-Fa-f]{2})|[^A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]/g, (c) => encodeURIComponent(c));
}

/** The curl config (`curl -K file`) for a request: no shell quoting anywhere. */
export function curlConfig(r: ResolvedRequest, files: CurlFiles, o: SendOptions): string {
  const lines = ["silent", "show-error", `url = ${curlQuote(encodeUrl(r.url))}`, `request = ${curlQuote(r.method)}`];
  for (const [k, v] of r.headers) lines.push(`header = ${curlQuote(v === "" ? `${k};` : `${k}: ${v}`)}`);
  if (files.body) lines.push(`data-binary = ${curlQuote(`@${files.body}`)}`);
  if (r.method === "HEAD") lines.push("head");
  lines.push(`output = ${curlQuote(files.out)}`, `dump-header = ${curlQuote(files.headers)}`);
  lines.push(`write-out = ${curlQuote(`\n${WRITE_OUT_FIELDS.map((f) => `${f}=%{${f}}`).join("\n")}\n`)}`);
  if (o.followRedirects) lines.push("location", "max-redirs = 10");
  if (o.insecure) lines.push("insecure");
  if (o.cookieJar) lines.push(`cookie = ${curlQuote(o.cookieJar)}`, `cookie-jar = ${curlQuote(o.cookieJar)}`);
  lines.push(`max-time = ${o.timeoutSecs}`, "compressed");
  return `${lines.join("\n")}\n`;
}

export interface Timing {
  dns: number;
  connect: number;
  tls: number;
  ttfb: number;
  total: number;
  /** ms for each phase (not cumulative). */
  phases: { label: string; ms: number }[];
}

export interface WriteOut {
  status: number;
  httpVersion: string;
  timing: Timing;
  sizeDownload: number;
  sizeUpload: number;
  redirects: number;
  remoteIp: string;
  effectiveUrl: string;
  contentType: string;
}

export function parseWriteOut(stdout: string): WriteOut {
  const kv: Record<string, string> = {};
  for (const l of stdout.split(/\r?\n/)) {
    const i = l.indexOf("=");
    if (i > 0) kv[l.slice(0, i)] = l.slice(i + 1);
  }
  const s = (k: string) => Number(kv[k] ?? 0) * 1000;
  const dns = s("time_namelookup");
  const connect = s("time_connect");
  const tls = s("time_appconnect");
  const pre = s("time_pretransfer");
  const ttfb = s("time_starttransfer");
  const total = s("time_total");
  const phases = [
    { label: "DNS", ms: dns },
    { label: "Connect", ms: Math.max(0, connect - dns) },
    { label: "TLS", ms: tls ? Math.max(0, tls - connect) : 0 },
    { label: "Request", ms: Math.max(0, pre - Math.max(connect, tls)) },
    { label: "Waiting", ms: Math.max(0, ttfb - pre) },
    { label: "Download", ms: Math.max(0, total - ttfb) },
  ];
  return {
    status: Number(kv.http_code ?? 0),
    httpVersion: kv.http_version ?? "",
    timing: { dns, connect, tls, ttfb, total, phases },
    sizeDownload: Number(kv.size_download ?? 0),
    sizeUpload: Number(kv.size_upload ?? 0),
    redirects: Number(kv.num_redirects ?? 0),
    remoteIp: kv.remote_ip ?? "",
    effectiveUrl: kv.url_effective ?? "",
    contentType: kv.content_type ?? "",
  };
}

export interface HeaderBlock {
  statusLine: string;
  status: number;
  statusText: string;
  headers: [string, string][];
}

/** `--dump-header` output: one block per response (redirects, 100 Continue); the last is the answer. */
export function parseHeaderDump(text: string): HeaderBlock[] {
  const blocks: HeaderBlock[] = [];
  for (const raw of text.split(/\r?\n\r?\n/)) {
    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (!lines.length || !/^HTTP\//.test(lines[0])) continue;
    const m = /^HTTP\/[\d.]+\s+(\d{3})\s*(.*)$/.exec(lines[0]);
    blocks.push({
      statusLine: lines[0],
      status: m ? Number(m[1]) : 0,
      statusText: m?.[2] ?? "",
      headers: lines.slice(1).map((l) => {
        const i = l.indexOf(":");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()] as [string, string];
      }),
    });
  }
  return blocks;
}

export interface Cookie {
  name: string;
  value: string;
  attrs: Record<string, string | true>;
}

export function parseSetCookies(headers: [string, string][]): Cookie[] {
  return headers
    .filter(([k]) => k.toLowerCase() === "set-cookie")
    .map(([, v]) => {
      const [pair, ...rest] = v.split(";");
      const i = pair.indexOf("=");
      const attrs: Record<string, string | true> = {};
      for (const a of rest) {
        const j = a.indexOf("=");
        if (a.trim()) attrs[(j < 0 ? a : a.slice(0, j)).trim().toLowerCase()] = j < 0 ? true : a.slice(j + 1).trim();
      }
      return { name: pair.slice(0, i).trim(), value: pair.slice(i + 1).trim(), attrs };
    });
}

export function header(headers: [string, string][], name: string): string | undefined {
  return headers.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
}

export type BodyKind = "json" | "xml" | "html" | "image" | "text" | "binary";

export function bodyKind(contentType: string): BodyKind {
  const ct = contentType.toLowerCase();
  if (/[/+]json\b/.test(ct)) return "json";
  if (/^image\//.test(ct)) return "image";
  if (/html/.test(ct)) return "html";
  if (/[/+]xml\b/.test(ct)) return "xml";
  if (/^text\/|javascript|csv|yaml|x-www-form-urlencoded/.test(ct) || !ct) return "text";
  return "binary";
}

/** Pretty-print a body for display (JSON indented; others unchanged). */
export function prettyBody(kind: BodyKind, text: string): string {
  if (kind === "json") {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  return text;
}

// ── code generation ───────────────────────────────────────────────────────

const sh = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

export function toCode(r: ResolvedRequest, lang: "curl" | "fetch" | "python" | "httpie"): string {
  const body = r.bodyFile ? null : r.body;
  switch (lang) {
    case "curl": {
      const parts = ["curl", ...(r.method !== "GET" ? ["-X", r.method] : []), sh(r.url)];
      for (const [k, v] of r.headers) parts.push("-H", sh(`${k}: ${v}`));
      if (r.bodyFile) parts.push("--data-binary", sh(`@${r.bodyFile}`));
      else if (body !== null) parts.push("--data-binary", sh(body));
      return parts.join(" \\\n  ");
    }
    case "fetch": {
      const init: string[] = [`  method: ${JSON.stringify(r.method)},`];
      if (r.headers.length) init.push(`  headers: ${JSON.stringify(Object.fromEntries(r.headers), null, 2).replace(/\n/g, "\n  ")},`);
      if (body !== null) init.push(`  body: ${JSON.stringify(body)},`);
      return `const res = await fetch(${JSON.stringify(r.url)}, {\n${init.join("\n")}\n});\nconst data = await res.${/json/i.test(header(r.headers, "accept") ?? header(r.headers, "content-type") ?? "") ? "json" : "text"}();`;
    }
    case "python": {
      const lines = ["import requests", "", `res = requests.request(`, `    ${JSON.stringify(r.method)},`, `    ${JSON.stringify(r.url)},`];
      if (r.headers.length) lines.push(`    headers=${JSON.stringify(Object.fromEntries(r.headers))},`);
      if (body !== null) lines.push(`    data=${JSON.stringify(body)},`);
      lines.push(")", "print(res.status_code, res.text)");
      return lines.join("\n");
    }
    case "httpie": {
      const parts = ["http", r.method, sh(r.url), ...r.headers.map(([k, v]) => sh(`${k}:${v}`))];
      return body !== null ? `printf %s ${sh(body)} | ${parts.join(" ")}` : parts.join(" ");
    }
  }
}
