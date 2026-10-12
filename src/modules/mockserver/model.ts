// Mock API server: validating the route table, reading it from a file, and
// building example requests.

import type { MockRequest, MockRoute } from "@/modules/tools/paneHandle";

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "*"];

export const SAMPLE_ROUTES: MockRoute[] = [
  { method: "GET", path: "/health", status: 200, body: '{"ok":true}' },
  { method: "GET", path: "/users", status: 200, body: '[{"id":1,"name":"Ada"},{"id":2,"name":"Linus"}]' },
  { method: "GET", path: "/users/:id", status: 200, body: '{"id":{{params.id}},"name":"User {{params.id}}"}' },
  { method: "POST", path: "/users", status: 201, body: '{"id":"{{uuid}}","created":{{now}},"received":{{body}}}' },
  { method: "DELETE", path: "/users/:id", status: 204, body: "" },
];

/** A problem with one route, or null when it can be served. */
export function routeProblem(r: MockRoute): string | null {
  if (!METHODS.includes(r.method.toUpperCase())) return `unknown method "${r.method}"`;
  if (!r.path.startsWith("/")) return "the path must start with /";
  if (/\s/.test(r.path)) return "the path cannot contain spaces";
  const segs = r.path.split("/").slice(1);
  if (segs.some((s, i) => s === "*" && i !== segs.length - 1)) return "* is only allowed as the last segment";
  if (segs.some((s) => s === ":")) return "a parameter needs a name after the colon";
  const status = r.status ?? 200;
  if (!Number.isInteger(status) || status < 100 || status > 599) return "the status must be between 100 and 599";
  if ((r.delayMs ?? 0) < 0 || (r.delayMs ?? 0) > 60000) return "the delay must be between 0 and 60000 ms";
  return null;
}

/** Routes that would never be reached because an earlier one matches the same requests. */
export function shadowed(routes: MockRoute[]): number[] {
  const shape = (p: string) => p.replace(/\/+$/, "").split("/").map((s) => (s.startsWith(":") ? ":" : s)).join("/");
  const out: number[] = [];
  routes.forEach((r, i) => {
    for (let j = 0; j < i; j++) {
      const e = routes[j];
      if ((e.method === "*" || e.method.toUpperCase() === r.method.toUpperCase()) && shape(e.path) === shape(r.path)) {
        out.push(i);
        break;
      }
    }
  });
  return out;
}

/** Reads a route file: a JSON array, or `{ "routes": [...] }`. Header maps become pairs. */
export function parseRoutes(text: string): { routes: MockRoute[]; error: string | null } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { routes: [], error: `Not valid JSON: ${(err as Error).message}` };
  }
  const list = Array.isArray(data) ? data : (data as { routes?: unknown })?.routes;
  if (!Array.isArray(list)) return { routes: [], error: 'Expected a JSON array of routes, or an object with a "routes" array.' };
  const routes: MockRoute[] = [];
  for (const [i, raw] of list.entries()) {
    if (!raw || typeof raw !== "object") return { routes: [], error: `Route ${i + 1} is not an object.` };
    const o = raw as Record<string, unknown>;
    const headers = Array.isArray(o.headers) ? (o.headers as [string, string][]) : o.headers && typeof o.headers === "object" ? Object.entries(o.headers as Record<string, unknown>).map(([k, v]) => [k, String(v)] as [string, string]) : [];
    const route: MockRoute = {
      method: String(o.method ?? "GET").toUpperCase(),
      path: String(o.path ?? ""),
      status: o.status === undefined ? 200 : Number(o.status),
      headers,
      body: typeof o.body === "string" ? o.body : o.body === undefined || o.body === null ? "" : JSON.stringify(o.body, null, 2),
      delayMs: o.delayMs === undefined ? 0 : Number(o.delayMs),
    };
    const problem = routeProblem(route);
    if (problem) return { routes: [], error: `Route ${i + 1} (${route.method} ${route.path || "?"}): ${problem}.` };
    routes.push(route);
  }
  return { routes, error: null };
}

/** The route table as a file: bodies that are JSON are written as JSON, not as strings. */
export function serializeRoutes(routes: MockRoute[]): string {
  const out = routes.map((r) => {
    let body: unknown = r.body ?? "";
    if (typeof body === "string" && !body.includes("{{")) {
      try {
        body = JSON.parse(body);
      } catch {
        // Kept as text.
      }
    }
    return {
      method: r.method,
      path: r.path,
      status: r.status ?? 200,
      ...(r.headers?.length ? { headers: Object.fromEntries(r.headers) } : {}),
      ...(r.delayMs ? { delayMs: r.delayMs } : {}),
      body,
    };
  });
  return `${JSON.stringify({ routes: out }, null, 2)}\n`;
}

/** A path a caller could actually request: parameters filled with sample values. */
export function examplePath(path: string): string {
  return path
    .split("/")
    .map((s) => (s === "*" ? "anything" : s.startsWith(":") ? (/id$/i.test(s) ? "1" : s.slice(1)) : s))
    .join("/");
}

export function curlFor(route: MockRoute, port: number): string {
  const method = route.method === "*" ? "GET" : route.method.toUpperCase();
  const parts = ["curl", "-i"];
  if (method !== "GET") parts.push("-X", method);
  if (["POST", "PUT", "PATCH"].includes(method)) parts.push("-H", '"Content-Type: application/json"', "-d", `'{"example":true}'`);
  parts.push(`http://127.0.0.1:${port}${examplePath(route.path)}`);
  return parts.join(" ");
}

/** Newest first, capped; `incoming` are the requests logged since the last poll. */
export function mergeLog(existing: MockRequest[], incoming: MockRequest[], cap = 300): MockRequest[] {
  if (!incoming.length) return existing;
  const seen = new Set(existing.map((r) => r.seq));
  const fresh = incoming.filter((r) => !seen.has(r.seq)).sort((a, b) => b.seq - a.seq);
  return [...fresh, ...existing].slice(0, cap);
}

export function statusTone(status: number): "ok" | "redirect" | "client" | "server" {
  return status >= 500 ? "server" : status >= 400 ? "client" : status >= 300 ? "redirect" : "ok";
}
