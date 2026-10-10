// Sending .http requests: environments, globals, request chaining (a request
// whose variables reference another named request's response sends that one
// first), pre-request and response scripts, curl in the background
// (cancellable), cookies, and per-file response history.

import { appCacheDir } from "@tauri-apps/api/path";
import { toast } from "sonner";
import { create } from "zustand";
import { IS_WINDOWS } from "@/lib/platform";
import { native } from "@/modules/ai/lib/native";
import { commandLine } from "@/modules/containers/model";
import {
  bodyKind,
  curlConfig,
  header,
  parseEnvironments,
  parseHeaderDump,
  parseHttpFile,
  parseWriteOut,
  resolveRequest,
  type BodyKind,
  type HeaderBlock,
  type ParsedRequest,
  type ResolvedRequest,
  type Timing,
  type VarContext,
} from "./model";
import { runScript, type ScriptResult } from "./scripts";

export interface HttpResponse {
  id: string;
  file: string;
  key: string;
  label: string;
  request: ResolvedRequest;
  at: number;
  status: number;
  statusText: string;
  httpVersion: string;
  headers: [string, string][];
  redirects: HeaderBlock[];
  kind: BodyKind;
  contentType: string;
  body: string | null;
  bodyPath: string;
  size: number;
  timing: Timing | null;
  remoteIp: string;
  script: ScriptResult | null;
  error: string | null;
}

interface HttpStore {
  /** file → selected environment name */
  env: Record<string, string | null>;
  envs: Record<string, Record<string, Record<string, string>>>;
  /** file → responses, newest first */
  history: Record<string, HttpResponse[]>;
  /** file → response shown in the panel */
  selected: Record<string, string | null>;
  running: Record<string, number | null>;
  globals: Record<string, string>;
  insecure: boolean;
}

const GLOBALS_KEY = "gear-http-globals";
const ENV_KEY = "gear-http-env";
const MAX_TEXT = 4 * 1024 * 1024;

function load<T>(k: string, d: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
}

function save(k: string, v: unknown): void {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export const useHttpStore = create<HttpStore>(() => ({ env: load(ENV_KEY, {}), envs: {}, history: {}, selected: {}, running: {}, globals: load(GLOBALS_KEY, {}), insecure: false }));

export const isHttpFile = (p: string) => /\.(http|rest)$/i.test(p);
export const requestKey = (r: ParsedRequest) => r.name ?? `#${r.index + 1} ${r.method} ${r.url}`;

const dirOf = (p: string) => p.replace(/\\/g, "/").replace(/\/[^/]*$/, "");

export async function loadEnvironments(file: string): Promise<Record<string, Record<string, string>>> {
  const dir = dirOf(file);
  const read = async (n: string) => {
    const r = await native.readFile(`${dir}/${n}`).catch(() => null);
    return r?.kind === "text" ? r.content : null;
  };
  try {
    const envs = parseEnvironments(await read("http-client.env.json"), await read("http-client.private.env.json"));
    useHttpStore.setState((s) => ({ envs: { ...s.envs, [file]: envs } }));
    const chosen = useHttpStore.getState().env[file];
    if (chosen && !envs[chosen]) setEnv(file, null);
    return envs;
  } catch (e) {
    toast.error("http-client.env.json isn't valid JSON", { description: String(e) });
    return {};
  }
}

export function setEnv(file: string, env: string | null): void {
  const next = { ...useHttpStore.getState().env, [file]: env };
  useHttpStore.setState({ env: next });
  save(ENV_KEY, next);
}

export function clearGlobals(): void {
  useHttpStore.setState({ globals: {} });
  save(GLOBALS_KEY, {});
}

function applyGlobals(changes: Record<string, string | null>): void {
  if (!Object.keys(changes).length) return;
  const globals = { ...useHttpStore.getState().globals };
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) delete globals[k];
    else globals[k] = v;
  }
  useHttpStore.setState({ globals });
  save(GLOBALS_KEY, globals);
}

function lastResponses(file: string): VarContext["responses"] {
  const out: VarContext["responses"] = {};
  // Oldest first so the newest response for a name wins.
  for (const r of [...(useHttpStore.getState().history[file] ?? [])].reverse()) if (!r.error && r.body !== null) out[r.key] = { status: r.status, headers: r.headers, body: r.body };
  return out;
}

async function workDir(): Promise<string> {
  const dir = `${(await appCacheDir()).replace(/\\/g, "/").replace(/\/+$/, "")}/http`;
  await native.createDir(dir).catch(() => {});
  return dir;
}

/** Send the request at `line` (0-based) of `file` whose current text is `text`. */
export async function sendAt(file: string, text: string, line: number): Promise<HttpResponse | null> {
  const parsed = parseHttpFile(text);
  const req = parsed.requests.find((r) => line >= r.startLine && line < r.endLine);
  if (!req) {
    toast.info("Put the cursor in a request (blocks are separated by ###)");
    return null;
  }
  return send(file, text, req.index);
}

export async function send(file: string, text: string, index: number, depth = 0): Promise<HttpResponse | null> {
  const parsed = parseHttpFile(text);
  const req = parsed.requests[index];
  if (!req) return null;
  const st = useHttpStore.getState();
  const envs = st.envs[file] ?? (await loadEnvironments(file));
  const envName = useHttpStore.getState().env[file] ?? null;
  const env = envName ? (envs[envName] ?? {}) : {};
  const ctx: VarContext = { file: parsed.vars, env, globals: useHttpStore.getState().globals, responses: lastResponses(file) };

  if (req.preScript) {
    const pre = await runScript(req.preScript, { kind: "pre", globals: ctx.globals, env });
    if (pre.error) toast.error("Pre-request script failed", { description: pre.error });
    applyGlobals(pre.globals);
    ctx.globals = useHttpStore.getState().globals;
    ctx.request = pre.requestVars;
  }

  let resolved = resolveRequest(req, ctx);
  // Chain: {{login.response…}} with no response yet → send "login" first.
  const needed = [...new Set(resolved.missing.map((m) => /^([\w-]+)\.response\./.exec(m)?.[1]).filter((n): n is string => !!n))];
  const chain = needed.map((n) => parsed.requests.find((r) => r.name === n)).filter((r): r is ParsedRequest => !!r && r.index !== index);
  if (chain.length && depth < 4) {
    for (const r of chain) {
      const res = await send(file, text, r.index, depth + 1);
      if (!res || res.error) return null;
    }
    ctx.responses = lastResponses(file);
    ctx.globals = useHttpStore.getState().globals;
    resolved = resolveRequest(req, ctx);
  }
  if (resolved.missing.length) {
    toast.error(`Unresolved variable${resolved.missing.length > 1 ? "s" : ""}: ${resolved.missing.join(", ")}`, { description: envName ? `Environment “${envName}”` : Object.keys(envs).length ? "No environment selected" : "Define it with @name = value, or in http-client.env.json" });
    return null;
  }

  const key = requestKey(req);
  const work = await workDir();
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const files = { body: null as string | null, out: `${work}/${id}.body`, headers: `${work}/${id}.headers` };
  if (resolved.bodyFile) files.body = /^([A-Za-z]:[\\/]|\/)/.test(resolved.bodyFile) ? resolved.bodyFile : `${dirOf(file)}/${resolved.bodyFile.replace(/^\.\//, "")}`;
  else if (resolved.body !== null) {
    files.body = `${work}/${id}.req`;
    await native.writeFile(files.body, resolved.body, "user");
  }
  const timeout = Number(req.directives.timeout) || 120;
  const cfg = `${work}/${id}.cfg`;
  await native.writeFile(cfg, curlConfig(resolved, files, { followRedirects: !("no-redirect" in req.directives), insecure: useHttpStore.getState().insecure, timeoutSecs: timeout, cookieJar: "no-cookie-jar" in req.directives ? null : `${work}/cookies.txt` }), "user");

  const handle = await native.shellBgSpawn(commandLine([IS_WINDOWS ? "curl.exe" : "curl", "-K", cfg], IS_WINDOWS), dirOf(file));
  useHttpStore.setState((s) => ({ running: { ...s.running, [file]: handle } }));
  let out = "";
  let offset = 0;
  let exit: number | null = null;
  try {
    for (;;) {
      const r = await native.shellBgLogs(handle, offset);
      out += r.bytes;
      offset = r.next_offset;
      if (r.exited) {
        exit = r.exit_code;
        break;
      }
      await new Promise((res) => setTimeout(res, 80));
    }
  } finally {
    useHttpStore.setState((s) => ({ running: { ...s.running, [file]: null } }));
  }

  const base: HttpResponse = { id, file, key, label: `${req.method} ${resolved.url}`, request: resolved, at: Date.now(), status: 0, statusText: "", httpVersion: "", headers: [], redirects: [], kind: "text", contentType: "", body: null, bodyPath: files.out, size: 0, timing: null, remoteIp: "", script: null, error: null };
  let res: HttpResponse;
  if (exit !== 0) {
    const msg = out.split("\n").find((l) => /^curl: \(\d+\)/.test(l)) ?? (exit === null ? "Cancelled" : `curl exited with ${exit}`);
    res = { ...base, error: msg.replace(/^curl: /, "") };
  } else {
    const wo = parseWriteOut(out);
    const dump = await native.readFile(files.headers).catch(() => null);
    const blocks = parseHeaderDump(dump?.kind === "text" ? dump.content : "");
    const last = blocks[blocks.length - 1];
    const contentType = wo.contentType || header(last?.headers ?? [], "content-type") || "";
    const kind = bodyKind(contentType);
    let body: string | null = null;
    if (kind !== "image" && kind !== "binary" && wo.sizeDownload <= MAX_TEXT) {
      const r = await native.readFile(files.out).catch(() => null);
      body = r?.kind === "text" ? r.content : r ? null : "";
    }
    res = { ...base, status: wo.status, statusText: last?.statusText ?? "", httpVersion: wo.httpVersion, headers: last?.headers ?? [], redirects: blocks.slice(0, -1).filter((b) => b.status >= 300 && b.status < 400), kind: body === null && kind !== "image" ? "binary" : kind, contentType, body, size: wo.sizeDownload, timing: wo.timing, remoteIp: wo.remoteIp };
    if (req.script) {
      res.script = await runScript(req.script, { kind: "post", globals: useHttpStore.getState().globals, env, response: { status: res.status, headers: res.headers, body: body ?? "", contentType } });
      applyGlobals(res.script.globals);
    }
  }
  useHttpStore.setState((s) => ({ history: { ...s.history, [file]: [res, ...(s.history[file] ?? [])].slice(0, 50) }, selected: { ...s.selected, [file]: res.id } }));
  return res;
}

export async function cancel(file: string): Promise<void> {
  const h = useHttpStore.getState().running[file];
  if (h) await native.shellBgKill(h).catch(() => {});
}

export async function sendAll(file: string, text: string): Promise<void> {
  const parsed = parseHttpFile(text);
  let failed = 0;
  for (const r of parsed.requests) {
    const res = await send(file, text, r.index);
    if (!res || res.error || res.status >= 400 || res.script?.tests.some((t) => !t.passed) || res.script?.error) failed++;
  }
  if (parsed.requests.length) (failed ? toast.error : toast.success)(`${parsed.requests.length - failed}/${parsed.requests.length} requests passed`);
}
