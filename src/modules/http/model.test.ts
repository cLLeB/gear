import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bodyKind, curlConfig, encodeUrl, jsonPath, parseEnvironments, parseHeaderDump, parseHttpFile, parseSetCookies, parseWriteOut, requestAtLine, resolve, resolveRequest, toCode, type VarContext } from "./model";
import { scriptSource, type ScriptInput, type ScriptResult } from "./scripts";

const FILE = `@base = http://127.0.0.1:{{port}}
@user = ada

### Log in
# @name login
POST {{base}}/login
Content-Type: application/json

{"user": "{{user}}", "nonce": "{{$uuid}}"}

> {%
  client.test("status 200", () => client.assert(response.status === 200, "got " + response.status));
  client.global.set("token", response.body.token);
%}

###
GET {{base}}/echo
    ?q=hello world
    &n=1
Authorization: Bearer {{login.response.body.$.token}}
X-Empty:

### Upload a file
# @no-redirect
POST {{base}}/echo
Content-Type: application/json

< ./payload.json

### Not a request, just notes
# nothing here
`;

describe("parsing", () => {
  const f = parseHttpFile(FILE);
  it("finds requests, names, scripts and directives", () => {
    expect(f.vars).toEqual({ base: "http://127.0.0.1:{{port}}", user: "ada" });
    expect(f.requests.map((r) => [r.name, r.method, r.line])).toEqual([
      ["login", "POST", 5],
      [null, "GET", 16],
      ["Upload a file", "POST", 24],
    ]);
    expect(f.requests[0].body).toBe('{"user": "{{user}}", "nonce": "{{$uuid}}"}');
    expect(f.requests[0].script).toContain('client.global.set("token", response.body.token);');
    expect(f.requests[1].url).toBe("{{base}}/echo?q=hello world&n=1");
    expect(f.requests[1].headers).toEqual([
      ["Authorization", "Bearer {{login.response.body.$.token}}"],
      ["X-Empty", ""],
    ]);
    expect(f.requests[2]).toMatchObject({ body: null, bodyFile: "./payload.json", directives: { "no-redirect": "" } });
    expect(requestAtLine(f, 18)?.index).toBe(1);
    expect(requestAtLine(f, 1)).toBeNull();
  });

  it("resolves variables, dynamics, environments and chained responses", () => {
    const ctx: VarContext = {
      file: f.vars,
      env: parseEnvironments('{"dev": {"port": "8080", "nested": {"a": 1}}}', '{"dev": {"secret": "s3"}}').dev,
      globals: {},
      responses: { login: { status: 200, headers: [["X-Req", "42"]], body: '{"token":"t-1","items":[{"id":7}]}' } },
      now: () => new Date("2026-01-02T03:04:05Z"),
      random: () => 0.5,
    };
    expect(ctx.env).toEqual({ port: "8080", nested: '{"a":1}', secret: "s3" });
    expect(resolve("{{base}}/x?t={{$timestamp}}&r={{$randomInt 10 20}}", ctx).text).toBe("http://127.0.0.1:8080/x?t=1767323045&r=15");
    expect(resolve("{{login.response.body.$.items[0].id}} {{login.response.headers.x-req}} {{$uuid}}", ctx).text).toBe("7 42 88888888-8888-4888-8888-888888888888");
    expect(resolve("{{nope}} {{other.response.body.$.x}}", ctx)).toEqual({ text: "{{nope}} {{other.response.body.$.x}}", missing: ["nope", "other.response.body.$.x"] });
    expect(resolveRequest(f.requests[1], ctx).headers[0]).toEqual(["Authorization", "Bearer t-1"]);
    expect(jsonPath({ a: { "b c": [1, { d: 2 }] } }, "$.a['b c'][1].d")).toBe(2);
    expect(jsonPath({ a: 1 }, "$.a.b.c")).toBeUndefined();
    expect(encodeUrl("https://x.dev/a b?q=ü&r=50%&ok=%20")).toBe("https://x.dev/a%20b?q=%C3%BC&r=50%25&ok=%20");
  });

  it("parses curl output", () => {
    const blocks = parseHeaderDump("HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 302 Found\r\nLocation: /b\r\n\r\nHTTP/2 200 \r\ncontent-type: application/json\r\nset-cookie: sid=abc; Path=/; HttpOnly\r\n\r\n");
    expect(blocks.map((b) => b.status)).toEqual([100, 302, 200]);
    expect(parseSetCookies(blocks[2].headers)).toEqual([{ name: "sid", value: "abc", attrs: { path: "/", httponly: true } }]);
    expect(bodyKind("application/problem+json; charset=utf-8")).toBe("json");
    expect(bodyKind("image/png")).toBe("image");
  });

  it("generates code", () => {
    const r = { method: "POST", url: "https://api.example.com/users", headers: [["Content-Type", "application/json"]] as [string, string][], body: '{"name":"Ada O\'Neil"}', bodyFile: null, missing: [] };
    expect(toCode(r, "curl")).toBe(`curl \\\n  -X \\\n  POST \\\n  https://api.example.com/users \\\n  -H \\\n  'Content-Type: application/json' \\\n  --data-binary \\\n  '{"name":"Ada O'\\''Neil"}'`);
    expect(toCode(r, "python")).toContain('data="{\\"name\\":\\"Ada O\'Neil\\"}"');
  });
});

describe("sending through curl", () => {
  let server: Server;
  let port = 0;
  const dir = mkdtempSync(join(tmpdir(), "gear-http-"));
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        if (req.url === "/login") {
          res.setHeader("Set-Cookie", "sid=xyz; Path=/; HttpOnly");
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify({ token: `tok-${JSON.parse(body).user}` }));
        }
        if (req.url === "/old") {
          res.statusCode = 301;
          res.setHeader("Location", "/echo?moved=1");
          return res.end();
        }
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => server.close());

  const send = async (r: ReturnType<typeof resolveRequest>, body: string | null, follow = true) => {
    const files = { body: body === null ? null : join(dir, "body"), out: join(dir, "out"), headers: join(dir, "headers") };
    if (body !== null) writeFileSync(files.body!, body);
    writeFileSync(join(dir, "cfg"), curlConfig(r, files, { followRedirects: follow, insecure: false, timeoutSecs: 10, cookieJar: join(dir, "jar") }));
    // Async: the test server runs on this same event loop.
    const { stdout } = await promisify(execFile)("curl", ["-K", join(dir, "cfg")], { encoding: "utf8" });
    return { wo: parseWriteOut(stdout), blocks: parseHeaderDump(readFileSync(files.headers, "utf8")), body: readFileSync(files.out, "utf8") };
  };

  it("chains a login into an authorized request, with odd characters intact", async () => {
    const f = parseHttpFile(FILE);
    const ctx: VarContext = { file: f.vars, env: { port: String(port) }, globals: {}, responses: {} };
    const login = resolveRequest(f.requests[0], ctx);
    expect(login.missing).toEqual([]);
    const r1 = await send(login, login.body);
    expect(r1.wo.status).toBe(200);
    expect(r1.wo.timing.total).toBeGreaterThan(0);
    expect(JSON.parse(r1.body)).toEqual({ token: "tok-ada" });
    ctx.responses.login = { status: 200, headers: r1.blocks[r1.blocks.length - 1].headers, body: r1.body };

    const echo = resolveRequest(f.requests[1], ctx);
    const r2 = await send(echo, null);
    const got = JSON.parse(r2.body);
    expect(got.url).toBe("/echo?q=hello%20world&n=1");
    expect(got.headers.authorization).toBe("Bearer tok-ada");
    expect(got.headers["x-empty"]).toBe("");
    // The cookie jar carried the session cookie.
    expect(got.headers.cookie).toBe("sid=xyz");

    const weird = { method: "PUT", url: `http://127.0.0.1:${port}/echo`, headers: [["X-Quote", `a "b" \\c 'd' $HOME`]] as [string, string][], body: 'line1\n"quoted" $(rm -rf /) `x`\n', bodyFile: null, missing: [] };
    const r3 = JSON.parse((await send(weird, weird.body)).body);
    expect(r3.method).toBe("PUT");
    expect(r3.headers["x-quote"]).toBe(`a "b" \\c 'd' $HOME`);
    expect(r3.body).toBe('line1\n"quoted" $(rm -rf /) `x`\n');
  });

  it("follows redirects or not", async () => {
    const r = { method: "GET", url: `http://127.0.0.1:${port}/old`, headers: [], body: null, bodyFile: null, missing: [] };
    const followed = await send(r, null, true);
    expect(followed.wo).toMatchObject({ status: 200, redirects: 1 });
    expect(followed.blocks.map((b) => b.status)).toEqual([301, 200]);
    const stopped = await send(r, null, false);
    expect(stopped.wo.status).toBe(301);
  });
});

describe("scripts", () => {
  const run = (script: string, input: ScriptInput): ScriptResult => {
    let result: ScriptResult | null = null;
    const self: Record<string, unknown> = { postMessage: (m: ScriptResult) => (result = m) };
    self.self = self;
    runInContext(scriptSource(script, input), createContext(self));
    return result!;
  };
  const response = { status: 201, headers: [["Content-Type", "application/json"], ["Set-Cookie", "a=1"], ["Set-Cookie", "b=2"]] as [string, string][], body: '{"id": 9, "tags": ["x"]}', contentType: "application/json; charset=utf-8" };

  it("runs tests and sets globals", () => {
    const r = run(
      `client.test("created", () => client.assert(response.status === 201));
client.test("has tags", () => client.assert(response.body.tags.length === 2, "expected 2 tags"));
client.global.set("id", response.body.id);
client.log("cookies", response.headers.valuesOf("set-cookie"), response.contentType.charset);`,
      { kind: "post", globals: { old: "1" }, env: {}, response },
    );
    expect(r.tests).toEqual([
      { name: "created", passed: true },
      { name: "has tags", passed: false, error: "expected 2 tags" },
    ]);
    expect(r.globals).toEqual({ id: "9" });
    expect(r.logs).toEqual(['cookies ["a=1","b=2"] utf-8']);
  });

  it("supports pre-request variables, exit and errors", () => {
    expect(run(`request.variables.set("sig", request.environment.get("key") + "-" + client.global.get("n")); client.exit(); client.log("never")`, { kind: "pre", globals: { n: "3" }, env: { key: "k" } })).toEqual({ tests: [], logs: [], globals: {}, requestVars: { sig: "k-3" } });
    expect(run(`response.nope.x`, { kind: "post", globals: {}, env: {}, response }).error).toMatch(/Cannot read properties of undefined/);
  });
});
