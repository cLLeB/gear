// HAR files (HTTP Archive, saved from a browser's Network panel): the
// requests in order, with timings, sizes and bodies, plus a redacted copy
// that is safe to share.

export type Kind = "document" | "fetch" | "script" | "style" | "image" | "font" | "media" | "websocket" | "other";

export interface Header {
  name: string;
  value: string;
}

export interface Timings {
  blocked: number;
  dns: number;
  connect: number;
  ssl: number;
  send: number;
  wait: number;
  receive: number;
}

export interface Request {
  index: number;
  method: string;
  url: string;
  host: string;
  /** Path and query, for the list. */
  path: string;
  status: number;
  statusText: string;
  mime: string;
  kind: Kind;
  /** Bytes over the wire when the file says so, else the body size; -1 when unknown. */
  transferred: number;
  /** Uncompressed body size; -1 when unknown. */
  size: number;
  /** Milliseconds from the first request's start. */
  start: number;
  time: number;
  timings: Timings;
  requestHeaders: Header[];
  responseHeaders: Header[];
  query: Header[];
  postData: { mime: string; text: string } | null;
  /** Response body as text; base64 bodies of text types are decoded. */
  body: string | null;
  bodyEncoding: "text" | "base64" | null;
  fromCache: boolean;
  serverIp: string;
  httpVersion: string;
}

export interface Har {
  requests: Request[];
  creator: string;
  pages: { title: string; onLoad: number | null; onContentLoad: number | null }[];
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const headers = (v: unknown): Header[] => (Array.isArray(v) ? v.filter((h) => h && typeof h === "object").map((h) => ({ name: str(h.name), value: str(h.value) })) : []);

export function kindOf(mime: string, url: string, resourceType = ""): Kind {
  const t = resourceType.toLowerCase();
  if (t === "websocket") return "websocket";
  if (t === "xhr" || t === "fetch") return "fetch";
  if (t === "document") return "document";
  const m = mime.toLowerCase().split(";")[0].trim();
  const ext = /\.([a-z0-9]+)(?:$|[?#])/i.exec(url.replace(/^[a-z]+:\/\/[^/]+/i, ""))?.[1]?.toLowerCase() ?? "";
  if (m === "text/html" || m === "application/xhtml+xml") return "document";
  if (/javascript|ecmascript/.test(m) || ["js", "mjs"].includes(ext)) return "script";
  if (m === "text/css" || ext === "css") return "style";
  if (m.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "avif"].includes(ext)) return "image";
  if (m.startsWith("font/") || /font/.test(m) || ["woff", "woff2", "ttf", "otf"].includes(ext)) return "font";
  if (m.startsWith("video/") || m.startsWith("audio/")) return "media";
  if (/json|xml|text\/plain|x-www-form/.test(m)) return "fetch";
  return "other";
}

function isTextMime(mime: string): boolean {
  return /^text\/|json|xml|javascript|ecmascript|x-www-form|svg|graphql/i.test(mime);
}

function decodeBase64Text(b64: string): string | null {
  try {
    const bin = atob(b64.replace(/\s+/g, ""));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Reads a HAR file. Throws with a plain message when it is not one. */
export function parseHar(text: string): Har {
  let doc: unknown;
  try {
    doc = JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    throw new Error(`This file is not valid JSON (${e instanceof Error ? e.message : String(e)}).`);
  }
  const log = (doc as { log?: Record<string, unknown> } | null)?.log;
  if (!log || !Array.isArray(log.entries)) throw new Error("This JSON is not a HAR file (it has no log.entries).");
  const raw = (log.entries as Record<string, any>[]).filter((e) => e && typeof e === "object");
  const starts = raw.map((e) => Date.parse(str(e.startedDateTime)));
  const valid = starts.filter((t) => Number.isFinite(t));
  const t0 = valid.length ? Math.min(...valid) : 0;
  const requests = raw.map((e, i): Request => {
    const req = e.request ?? {};
    const res = e.response ?? {};
    const content = res.content ?? {};
    const url = str(req.url);
    let host = "";
    let path = url;
    try {
      const u = new URL(url);
      host = u.host;
      path = u.pathname + u.search;
    } catch {
      // Not a full URL (data:, about:blank…); shown as it is.
    }
    const mime = str(content.mimeType) || headers(res.headers).find((h) => h.name.toLowerCase() === "content-type")?.value || "";
    const t = e.timings ?? {};
    const timings: Timings = { blocked: num(t.blocked), dns: num(t.dns), connect: num(t.connect), ssl: num(t.ssl), send: num(t.send), wait: num(t.wait), receive: num(t.receive) };
    // `connect` includes `ssl` in HAR; keep the two apart for the waterfall.
    timings.connect = Math.max(0, timings.connect - timings.ssl);
    const sum = timings.blocked + timings.dns + timings.connect + timings.ssl + timings.send + timings.wait + timings.receive;
    let body: string | null = typeof content.text === "string" ? content.text : null;
    let bodyEncoding: Request["bodyEncoding"] = body === null ? null : "text";
    if (body !== null && content.encoding === "base64") {
      const decoded = isTextMime(mime) ? decodeBase64Text(body) : null;
      if (decoded !== null) body = decoded;
      else bodyEncoding = "base64";
    }
    const transferred = typeof res._transferSize === "number" && res._transferSize >= 0 ? res._transferSize : typeof res.bodySize === "number" && res.bodySize >= 0 ? res.bodySize + Math.max(0, num(res.headersSize)) : -1;
    const status = typeof res.status === "number" ? res.status : 0;
    return {
      index: i,
      method: str(req.method) || "GET",
      url,
      host,
      path,
      status,
      statusText: str(res.statusText),
      mime,
      kind: kindOf(mime, url, str(e._resourceType)),
      transferred,
      size: typeof content.size === "number" && content.size >= 0 ? content.size : -1,
      start: Number.isFinite(starts[i]) ? starts[i] - t0 : 0,
      time: num(e.time) || sum,
      timings,
      requestHeaders: headers(req.headers),
      responseHeaders: headers(res.headers),
      query: headers(req.queryString),
      postData: req.postData ? { mime: str(req.postData.mimeType), text: str(req.postData.text) || (Array.isArray(req.postData.params) ? req.postData.params.map((p: Header) => `${str(p.name)}=${str(p.value)}`).join("&") : "") } : null,
      body,
      bodyEncoding,
      fromCache: status === 304 || Boolean(e.cache && (e.cache.beforeRequest || e.cache.afterRequest)) || res._fetchedViaServiceWorker === true || transferred === 0,
      serverIp: str(e.serverIPAddress).replace(/^\[|\]$/g, ""),
      httpVersion: str(res.httpVersion) || str(req.httpVersion),
    };
  });
  requests.sort((a, b) => a.start - b.start || a.index - b.index);
  const creator = log.creator && typeof log.creator === "object" ? `${str((log.creator as Record<string, unknown>).name)} ${str((log.creator as Record<string, unknown>).version)}`.trim() : "";
  const pages = Array.isArray(log.pages)
    ? (log.pages as Record<string, any>[]).map((p) => ({
        title: str(p?.title),
        onLoad: typeof p?.pageTimings?.onLoad === "number" && p.pageTimings.onLoad >= 0 ? p.pageTimings.onLoad : null,
        onContentLoad: typeof p?.pageTimings?.onContentLoad === "number" && p.pageTimings.onContentLoad >= 0 ? p.pageTimings.onContentLoad : null,
      }))
    : [];
  return { requests, creator, pages };
}

export type StatusFilter = "all" | "ok" | "redirect" | "client" | "server" | "failed";

export interface Filter {
  text: string;
  kinds: Set<Kind>;
  status: StatusFilter;
}

export function statusClass(status: number): Exclude<StatusFilter, "all"> {
  if (status <= 0) return "failed";
  if (status < 300) return "ok";
  if (status < 400) return "redirect";
  if (status < 500) return "client";
  return "server";
}

/**
 * Filters requests. The text matches the URL, or narrows with prefixes:
 * `method:POST`, `status:404`, `status:4xx`, `domain:api.example.com`,
 * `larger-than:100k`, and `-word` to exclude. Several terms must all match.
 */
export function filterRequests(requests: Request[], f: Filter): Request[] {
  const terms = f.text.trim().split(/\s+/).filter(Boolean);
  return requests.filter((r) => {
    if (f.kinds.size && !f.kinds.has(r.kind)) return false;
    if (f.status !== "all" && statusClass(r.status) !== f.status) return false;
    return terms.every((term) => {
      const neg = term.startsWith("-") && term.length > 1;
      const t = neg ? term.slice(1) : term;
      return matches(r, t) !== neg;
    });
  });
}

function parseSize(s: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(b|k|kb|m|mb)?$/i.exec(s);
  if (!m) return null;
  const unit = (m[2] ?? "b").toLowerCase()[0];
  return Number(m[1]) * (unit === "k" ? 1024 : unit === "m" ? 1024 * 1024 : 1);
}

function matches(r: Request, term: string): boolean {
  const colon = term.indexOf(":");
  const key = colon > 0 ? term.slice(0, colon).toLowerCase() : "";
  const value = colon > 0 ? term.slice(colon + 1) : term;
  switch (key) {
    case "method":
      return r.method.toLowerCase() === value.toLowerCase();
    case "status":
      return /^\dxx$/i.test(value) ? Math.floor(r.status / 100) === Number(value[0]) : String(r.status) === value;
    case "domain":
      return value.startsWith("*.") ? r.host.toLowerCase().endsWith(value.slice(1).toLowerCase()) : r.host.toLowerCase() === value.toLowerCase();
    case "larger-than": {
      const n = parseSize(value);
      return n !== null && Math.max(r.transferred, r.size) > n;
    }
    case "mime":
      return r.mime.toLowerCase().includes(value.toLowerCase());
    default:
      return r.url.toLowerCase().includes(term.toLowerCase());
  }
}

export interface Summary {
  requests: number;
  transferred: number;
  size: number;
  /** From the first start to the last finish, in ms. */
  span: number;
  failed: number;
  cached: number;
  byKind: { kind: Kind; count: number; transferred: number }[];
  byHost: { host: string; count: number; transferred: number; time: number }[];
  slowest: Request[];
  largest: Request[];
  /** Same method + URL requested more than once. */
  duplicates: { method: string; url: string; count: number }[];
}

export function summarize(requests: Request[]): Summary {
  const kinds = new Map<Kind, { count: number; transferred: number }>();
  const hosts = new Map<string, { count: number; transferred: number; time: number }>();
  const seen = new Map<string, number>();
  let transferred = 0;
  let size = 0;
  let end = 0;
  let begin = Infinity;
  for (const r of requests) {
    const t = Math.max(0, r.transferred);
    transferred += t;
    size += Math.max(0, r.size);
    begin = Math.min(begin, r.start);
    end = Math.max(end, r.start + r.time);
    const k = kinds.get(r.kind) ?? { count: 0, transferred: 0 };
    k.count++;
    k.transferred += t;
    kinds.set(r.kind, k);
    const h = hosts.get(r.host || "(no host)") ?? { count: 0, transferred: 0, time: 0 };
    h.count++;
    h.transferred += t;
    h.time += r.time;
    hosts.set(r.host || "(no host)", h);
    if (/^https?:/i.test(r.url)) {
      const key = `${r.method} ${r.url}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  return {
    requests: requests.length,
    transferred,
    size,
    span: requests.length ? end - begin : 0,
    failed: requests.filter((r) => statusClass(r.status) === "failed" || r.status >= 400).length,
    cached: requests.filter((r) => r.fromCache).length,
    byKind: [...kinds].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.transferred - a.transferred || b.count - a.count),
    byHost: [...hosts].map(([host, v]) => ({ host, ...v })).sort((a, b) => b.count - a.count || b.transferred - a.transferred),
    slowest: [...requests].sort((a, b) => b.time - a.time).slice(0, 5),
    largest: [...requests].sort((a, b) => Math.max(b.transferred, b.size) - Math.max(a.transferred, a.size)).slice(0, 5),
    duplicates: [...seen]
      .filter(([, n]) => n > 1)
      .map(([key, count]) => ({ method: key.slice(0, key.indexOf(" ")), url: key.slice(key.indexOf(" ") + 1), count }))
      .sort((a, b) => b.count - a.count),
  };
}

const PHASES: (keyof Timings)[] = ["blocked", "dns", "connect", "ssl", "send", "wait", "receive"];

/** The waterfall bar of one request: its phases as [phase, from, width] in ms from the start. */
export function phases(r: Request): { phase: keyof Timings; from: number; width: number }[] {
  const out: { phase: keyof Timings; from: number; width: number }[] = [];
  let at = r.start;
  const total = PHASES.reduce((a, p) => a + r.timings[p], 0);
  // Some tools only record the total time; show it as waiting.
  if (total === 0 && r.time > 0) return [{ phase: "wait", from: r.start, width: r.time }];
  for (const p of PHASES) {
    const w = r.timings[p];
    if (w > 0) out.push({ phase: p, from: at, width: w });
    at += w;
  }
  return out;
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** Headers the browser sets by itself, and HTTP/2 pseudo-headers; not worth copying. */
const SKIP_HEADERS = /^(:|content-length$|host$|connection$|accept-encoding$)/i;

/** The request as a curl command for a POSIX shell. */
export function toCurl(r: Request): string {
  const parts = [`curl ${shellQuote(r.url)}`];
  if (r.method !== "GET" && !(r.method === "POST" && r.postData)) parts.push(`-X ${r.method}`);
  for (const h of r.requestHeaders) if (!SKIP_HEADERS.test(h.name)) parts.push(`-H ${shellQuote(`${h.name}: ${h.value}`)}`);
  if (r.postData?.text) parts.push(`--data-raw ${shellQuote(r.postData.text)}`);
  parts.push("--compressed");
  return parts.join(" \\\n  ");
}

/** The request as a fetch() call. */
export function toFetch(r: Request): string {
  const init: Record<string, unknown> = { method: r.method };
  const hs = Object.fromEntries(r.requestHeaders.filter((h) => !SKIP_HEADERS.test(h.name) && h.name.toLowerCase() !== "cookie").map((h) => [h.name, h.value]));
  if (Object.keys(hs).length) init.headers = hs;
  if (r.postData?.text) init.body = r.postData.text;
  return `await fetch(${JSON.stringify(r.url)}, ${JSON.stringify(init, null, 2)});`;
}

const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-csrf-token|x-xsrf-token|x-amz-security-token)$/i;
const SECRET_PARAM = /^(access_token|id_token|refresh_token|token|code|api_key|apikey|key|password|passwd|secret|client_secret|sig|signature|session|sessionid|auth)$/i;
const MASK = "[redacted]";

export interface RedactOptions {
  /** Drop response and request bodies too (they may hold personal data). */
  bodies: boolean;
}

/**
 * A copy of the HAR with credentials removed: auth and cookie headers, the
 * cookie lists, and secret-looking query parameters (in the URL as well).
 * Returns the new JSON and how many values were masked.
 */
export function redactHar(text: string, opts: RedactOptions): { json: string; masked: number } {
  const doc = JSON.parse(text.replace(/^﻿/, ""));
  let masked = 0;
  const maskHeaders = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const h of list) {
      if (h && typeof h === "object" && SECRET_HEADER.test(str(h.name)) && h.value !== MASK) {
        h.value = MASK;
        masked++;
      }
    }
  };
  const maskParams = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const p of list) {
      if (p && typeof p === "object" && SECRET_PARAM.test(str(p.name)) && p.value !== MASK) {
        p.value = MASK;
        masked++;
      }
    }
  };
  const maskUrl = (url: string): string => {
    try {
      const u = new URL(url);
      let changed = false;
      for (const [k] of [...u.searchParams]) {
        if (SECRET_PARAM.test(k) && u.searchParams.get(k) !== MASK) {
          u.searchParams.set(k, MASK);
          changed = true;
        }
      }
      if (u.username || u.password) {
        u.username = "";
        u.password = "";
        changed = true;
      }
      return changed ? u.toString() : url;
    } catch {
      return url;
    }
  };
  for (const e of doc?.log?.entries ?? []) {
    const req = e?.request;
    const res = e?.response;
    if (req) {
      maskHeaders(req.headers);
      maskParams(req.queryString);
      if (Array.isArray(req.cookies) && req.cookies.length) {
        masked += req.cookies.length;
        req.cookies = [];
      }
      if (typeof req.url === "string") req.url = maskUrl(req.url);
      if (req.postData) {
        maskParams(req.postData.params);
        if (opts.bodies && req.postData.text) {
          req.postData.text = "";
          masked++;
        } else if (typeof req.postData.text === "string" && /x-www-form-urlencoded/i.test(str(req.postData.mimeType))) {
          const form = new URLSearchParams(req.postData.text);
          let hit = false;
          for (const [k] of [...form]) if (SECRET_PARAM.test(k)) (form.set(k, MASK), (hit = true), masked++);
          if (hit) req.postData.text = form.toString();
        }
      }
    }
    if (res) {
      maskHeaders(res.headers);
      if (Array.isArray(res.cookies) && res.cookies.length) {
        masked += res.cookies.length;
        res.cookies = [];
      }
      if (typeof res.redirectURL === "string" && res.redirectURL) res.redirectURL = maskUrl(res.redirectURL);
      if (opts.bodies && res.content && typeof res.content.text === "string" && res.content.text) {
        res.content.text = "";
        delete res.content.encoding;
        masked++;
      }
    }
  }
  return { json: JSON.stringify(doc, null, 2), masked };
}

export function formatMs(ms: number): string {
  if (ms < 1) return ms > 0 ? "<1 ms" : "0 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return ms < 60000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;
}
