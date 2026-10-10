// store.send end to end: real curl against a local server, with the Tauri
// bridge replaced by real processes / files and scripts run in a VM.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { createContext, runInContext } from "node:vm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ScriptInput, ScriptResult } from "./scripts";

const cache = mkdtempSync(`${tmpdir()}/gear-http-cache-`);
const work = mkdtempSync(`${tmpdir()}/gear-http-ws-`);
const bg = new Map<number, { p: ChildProcess; out: string; code: number | null; exited: boolean }>();

vi.mock("@tauri-apps/api/path", () => ({ appCacheDir: async () => cache }));
vi.mock("sonner", () => ({ toast: Object.assign(() => 0, { error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    readFile: async (p: string) => (existsSync(p) ? { kind: "text", content: readFileSync(p, "utf8"), size: 0 } : Promise.reject(new Error("missing"))),
    writeFile: async (p: string, c: string) => writeFileSync(p, c),
    createDir: async (p: string) => void mkdirSync(p, { recursive: true }),
    shellBgSpawn: async (command: string, cwd: string | null) => {
      const p = spawn("sh", ["-c", command], { cwd: cwd ?? undefined });
      const id = bg.size + 1;
      const e = { p, out: "", code: null as number | null, exited: false };
      p.stdout!.on("data", (d) => (e.out += d));
      p.stderr!.on("data", (d) => (e.out += d));
      p.on("exit", (c) => Object.assign(e, { code: c, exited: true }));
      bg.set(id, e);
      return id;
    },
    shellBgLogs: async (id: number, since = 0) => {
      const e = bg.get(id)!;
      return { bytes: e.out.slice(since), next_offset: e.out.length, dropped: 0, exited: e.exited, exit_code: e.code };
    },
    shellBgKill: async (id: number) => void bg.get(id)?.p.kill(),
  },
}));
vi.mock("./scripts", async () => {
  const real = await vi.importActual<typeof import("./scripts")>("./scripts");
  return {
    ...real,
    runScript: async (script: string, input: ScriptInput) => {
      let result: ScriptResult | null = null;
      const self: Record<string, unknown> = { postMessage: (m: ScriptResult) => (result = m) };
      self.self = self;
      runInContext(real.scriptSource(script, input), createContext(self));
      return result!;
    },
  };
});

let server: Server;
let port = 0;
const seen: { url: string; auth?: string; body: string }[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      seen.push({ url: req.url!, auth: req.headers.authorization, body });
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/login") return res.end(JSON.stringify({ token: "T-123", user: { id: 7 } }));
      if (req.url === "/fail") {
        res.statusCode = 503;
        return res.end("{}");
      }
      res.end(JSON.stringify({ ok: true, url: req.url }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
});
afterAll(() => server.close());

describe("http store", () => {
  it("chains, runs scripts, keeps globals, and reads environments", async () => {
    const s = await import("./store");
    writeFileSync(`${work}/http-client.env.json`, JSON.stringify({ local: { host: `http://127.0.0.1:${port}` } }));
    writeFileSync(`${work}/http-client.private.env.json`, JSON.stringify({ local: { secret: "pw" } }));
    writeFileSync(`${work}/payload.json`, '{"from":"file"}');
    const file = `${work}/api.http`;
    const text = `### Profile (needs login → sent first automatically)
GET {{host}}/me/{{login.response.body.$.user.id}}
Authorization: Bearer {{login.response.body.$.token}}

> {% client.test("ok", () => client.assert(response.body.ok)); client.global.set("seen", response.body.url) %}

### Log in
# @name login
< {% request.variables.set("pw", request.environment.get("secret") + "!") %}
POST {{host}}/login
Content-Type: application/json

{"password": "{{pw}}"}

### Upload
POST {{host}}/upload?last={{seen}}
Content-Type: application/json

< ./payload.json

### Broken
GET {{host}}/fail
`;
    await s.loadEnvironments(file);
    expect(Object.keys(s.useHttpStore.getState().envs[file])).toEqual(["local"]);
    // No environment yet: unresolved.
    expect(await s.send(file, text, 0)).toBeNull();
    s.setEnv(file, "local");

    const me = await s.send(file, text, 0);
    expect(seen.map((x) => x.url)).toEqual(["/login", "/me/7"]);
    expect(seen[0].body).toBe('{"password": "pw!"}');
    expect(seen[1].auth).toBe("Bearer T-123");
    expect(me).toMatchObject({ status: 200, kind: "json", error: null });
    expect(me!.script!.tests).toEqual([{ name: "ok", passed: true }]);
    expect(me!.timing!.total).toBeGreaterThan(0);
    expect(s.useHttpStore.getState().globals.seen).toBe("/me/7");

    const up = await s.send(file, text, 2);
    expect(seen[seen.length - 1]).toMatchObject({ url: "/upload?last=/me/7", body: '{"from":"file"}' });
    expect(up!.status).toBe(200);

    const fail = await s.send(file, text, 3);
    expect(fail).toMatchObject({ status: 503, error: null });
    expect(s.useHttpStore.getState().history[file].map((h) => h.key)).toEqual(["Broken", "Upload", "Profile (needs login → sent first automatically)", "login"]);

    // Connection errors are reported, not thrown.
    const dead = await s.send(file, text.replace(/\{\{host\}\}\/fail/, "http://127.0.0.1:9/x"), 3);
    expect(dead!.error).toMatch(/Failed to connect|Couldn't connect/);
  }, 30_000);
});
