// JetBrains-style request scripts for .http files, run in a throwaway worker:
//   < {% request.variables.set("ts", Date.now()) %}           (pre-request)
//   > {% client.test("ok", () => client.assert(response.status === 200)); client.global.set("token", response.body.token) %}
// The script text is pasted into the worker source as a function body, so it
// runs under the app CSP (no eval).

export interface ScriptResult {
  tests: { name: string; passed: boolean; error?: string }[];
  logs: string[];
  globals: Record<string, string | null>;
  requestVars: Record<string, string>;
  error?: string;
}

export interface ScriptInput {
  kind: "pre" | "post";
  globals: Record<string, string>;
  env: Record<string, string>;
  response?: { status: number; headers: [string, string][]; body: string; contentType: string };
}

const RUNTIME = String.raw`
const __out = { tests: [], logs: [], globals: {}, requestVars: {} };
const __g = Object.assign({}, __IN.globals);
const __str = (v) => (typeof v === "string" ? v : v === undefined ? "undefined" : JSON.stringify(v));
class __Exit extends Error {}
const client = {
  log: (...a) => { __out.logs.push(a.map(__str).join(" ")); },
  test: (name, fn) => {
    try { fn(); __out.tests.push({ name: String(name), passed: true }); }
    catch (e) { if (e instanceof __Exit) throw e; __out.tests.push({ name: String(name), passed: false, error: String((e && e.message) || e) }); }
  },
  assert: (cond, message) => { if (!cond) throw new Error(message || "Assertion failed"); },
  exit: () => { throw new __Exit(); },
  global: {
    set: (k, v) => { __g[k] = v == null ? null : __str(v); __out.globals[k] = __g[k]; },
    get: (k) => (k in __g ? __g[k] : null),
    isEmpty: () => Object.keys(__g).filter((k) => __g[k] != null).length === 0,
    clear: (k) => { __g[k] = null; __out.globals[k] = null; },
    clearAll: () => { for (const k of Object.keys(__g)) { __g[k] = null; __out.globals[k] = null; } },
  },
};
const request = {
  variables: { set: (k, v) => { __out.requestVars[k] = __str(v); }, get: (k) => __out.requestVars[k] ?? null },
  environment: { get: (k) => (__IN.env[k] ?? null) },
};
let response;
if (__IN.response) {
  const r = __IN.response;
  let body = r.body;
  if (/json/i.test(r.contentType)) { try { body = JSON.parse(r.body); } catch {} }
  const ct = r.contentType.split(";");
  response = {
    status: r.status,
    body,
    headers: {
      valueOf: (n) => { const h = r.headers.find(([k]) => k.toLowerCase() === String(n).toLowerCase()); return h ? h[1] : null; },
      valuesOf: (n) => r.headers.filter(([k]) => k.toLowerCase() === String(n).toLowerCase()).map(([, v]) => v),
    },
    contentType: { mimeType: ct[0].trim(), charset: ((ct.find((p) => /charset=/i.test(p)) || "").split("=")[1] || "").trim() },
  };
}
const console = { log: client.log, info: client.log, warn: client.log, error: client.log, debug: client.log };
self.fetch = () => Promise.reject(new Error("Network access isn't available in request scripts"));
try {
  __SCRIPT(client, request, response, console);
} catch (e) {
  if (!(e instanceof __Exit)) __out.error = String((e && e.message) || e);
}
self.postMessage(__out);
`;

export function scriptSource(script: string, input: ScriptInput): string {
  return `"use strict";\nconst __IN = ${JSON.stringify(input)};\nfunction __SCRIPT(client, request, response, console) {\n${script}\n}\n${RUNTIME}`;
}

/** Run a script in a worker (killed after `timeoutMs`). */
export function runScript(script: string, input: ScriptInput, timeoutMs = 5000): Promise<ScriptResult> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([scriptSource(script, input)], { type: "text/javascript" }));
    const w = new Worker(url);
    const done = (r: ScriptResult) => {
      clearTimeout(timer);
      w.terminate();
      URL.revokeObjectURL(url);
      resolve(r);
    };
    const timer = setTimeout(() => done({ tests: [], logs: [], globals: {}, requestVars: {}, error: `Script timed out after ${timeoutMs / 1000}s` }), timeoutMs);
    w.onmessage = (e) => done(e.data as ScriptResult);
    w.onerror = (e) => {
      e.preventDefault();
      done({ tests: [], logs: [], globals: {}, requestVars: {}, error: e.message || "Script error" });
    };
  });
}
