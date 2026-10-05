// End-to-end: drive real debug adapters (debugpy, gdb's DAP mode, Delve) with
// the session code. Each case is skipped when its adapter isn't installed.

import { execSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DapClient, type DapTransport } from "./dapClient";
import { DebugSession, type SessionState, type SourceBreakpoint } from "./debugSession";

function has(cmd: string): boolean {
  try {
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Content-Length framing over any byte stream. */
function framed(write: (b: Buffer) => void, subscribe: (cb: (b: Buffer) => void) => void, closeIt: () => void, onEnd: (cb: () => void) => void): DapTransport {
  let buf = Buffer.alloc(0);
  let handler: (m: string) => void = () => {};
  subscribe((chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const end = buf.indexOf("\r\n\r\n");
      if (end < 0) return;
      const len = Number(/Content-Length: (\d+)/i.exec(buf.subarray(0, end).toString())?.[1]);
      if (buf.length < end + 4 + len) return;
      const body = buf.subarray(end + 4, end + 4 + len).toString();
      buf = buf.subarray(end + 4 + len);
      handler(body);
    }
  });
  const closers: ((i: { code: number | null; output: string; reason: string | null }) => void)[] = [];
  onEnd(() => closers.forEach((c) => c({ code: null, output: "", reason: null })));
  return {
    send: (m) => write(Buffer.from(`Content-Length: ${Buffer.byteLength(m)}\r\n\r\n${m}`)),
    onMessage: (cb) => (handler = cb),
    onClose: (cb) => closers.push(cb),
    close: closeIt,
  };
}

function stdioTransport(cmd: string, args: string[], cwd: string): { t: DapTransport; p: ChildProcess } {
  const p = spawn(cmd, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
  const t = framed((b) => p.stdin!.write(b), (cb) => p.stdout!.on("data", cb), () => p.kill(), (cb) => p.on("exit", cb));
  return { t, p };
}

async function freePort(): Promise<number> {
  return new Promise((r) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => r(port));
    });
  });
}

async function tcpTransport(port: number): Promise<DapTransport> {
  for (let i = 0; i < 100; i++) {
    try {
      const sock = await new Promise<ReturnType<typeof createConnection>>((res, rej) => {
        const s = createConnection(port, "127.0.0.1", () => res(s));
        s.on("error", rej);
      });
      return framed((b) => sock.write(b), (cb) => sock.on("data", cb), () => sock.destroy(), (cb) => sock.on("close", cb));
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new Error("no connection");
}

function harness(path: string, lines: number[]) {
  const states: SessionState[] = [];
  const output: string[] = [];
  const bps = new Map<string, SourceBreakpoint[]>([[path, lines.map((line) => ({ line, enabled: true }))]]);
  const hooks = {
    breakpoints: () => bps,
    exceptionFilters: () => [],
    onState: (s: SessionState) => states.push(s),
    onOutput: (_c: string, t: string) => output.push(t),
  };
  const until = async (pred: (s: SessionState) => boolean, ms = 20_000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const s = states[states.length - 1];
      if (s && pred(s)) return s;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`timeout; last state ${JSON.stringify(states[states.length - 1])}\n${output.join("")}`);
  };
  return { hooks, states, output, until, bps };
}

const dir = mkdtempSync(join(tmpdir(), "gear-dap-"));

describe("debug sessions against real adapters", () => {
  it.skipIf(!has("python3 -c 'import debugpy'"))("debugpy: breakpoint, locals, evaluate, step, continue", async () => {
    const file = join(dir, "prog.py");
    writeFileSync(file, "def area(w, h):\n    result = w * h\n    return result\n\nprint('total', area(3, 4) + area(5, 6))\n");
    const { t, p } = stdioTransport("python3", ["-m", "debugpy.adapter"], dir);
    const h = harness(file, [2]);
    const s = new DebugSession(new DapClient(t), { name: "py", adapterId: "python", request: "launch", args: { program: file, console: "internalConsole", justMyCode: true, cwd: dir } }, h.hooks);
    await s.start().catch((e) => {
      throw new Error(`${e.message}\n${h.output.join("")}`);
    });
    let st = await h.until((x) => x.status === "stopped");
    expect(st.frames[0]).toMatchObject({ name: "area", line: 2, path: file });
    const scopes = await s.scopes(st.frames[0].id);
    const locals = await s.variables(scopes[0].variablesReference);
    expect(locals.filter((v) => ["w", "h"].includes(v.name)).map((v) => `${v.name}=${v.value}`).sort()).toEqual(["h=4", "w=3"]);
    expect((await s.evaluate("w * h + 1", st.frames[0].id)).result).toBe("13");
    expect(h.states.some((x) => x.verified[file]?.[0]?.verified)).toBe(true);
    await s.next();
    st = await h.until((x) => x.status === "stopped" && x.frames[0]?.line === 3);
    await s.continue();
    st = await h.until((x) => x.status === "stopped" && x.frames[0]?.line === 2);
    const l2 = await s.variables((await s.scopes(st.frames[0].id))[0].variablesReference);
    expect(l2.find((v) => v.name === "w")?.value).toBe("5");
    h.bps.set(file, []);
    await s.syncBreakpoints(file);
    await s.continue();
    await h.until((x) => x.status === "ended");
    expect(h.output.join("")).toContain("total 42");
    p.kill();
  }, 60_000);

  it.skipIf(!has("gdb --version") || !has("cc --version"))("gdb (DAP): C program", async () => {
    const src = join(dir, "prog.c");
    writeFileSync(src, '#include <stdio.h>\nint square(int x) {\n  int y = x * x;\n  return y;\n}\nint main(void) {\n  printf("%d\\n", square(7));\n  return 0;\n}\n');
    execSync(`cc -g -O0 -o ${join(dir, "prog")} ${src}`);
    const { t, p } = stdioTransport("gdb", ["-q", "-i", "dap"], dir);
    const h = harness(src, [3]);
    const s = new DebugSession(new DapClient(t), { name: "c", adapterId: "gdb", request: "launch", args: { program: join(dir, "prog"), cwd: dir } }, h.hooks);
    await s.start().catch((e) => {
      throw new Error(`${e.message}\n${h.output.join("")}`);
    });
    const st = await h.until((x) => x.status === "stopped");
    expect(st.frames[0]).toMatchObject({ name: "square", line: 3 });
    expect(st.frames[1]?.name).toBe("main");
    const scopes = await s.scopes(st.frames[0].id);
    const vars = (await Promise.all(scopes.map((sc) => s.variables(sc.variablesReference)))).flat();
    expect(vars.find((v) => v.name === "x")?.value).toBe("7");
    await s.stepOut();
    await h.until((x) => x.status === "stopped" && x.frames[0]?.name === "main");
    await s.continue();
    await h.until((x) => x.status === "ended");
    p.kill();
  }, 60_000);

  const dlv = `${process.env.HOME}/go/bin/dlv`;
  it.skipIf(!has(`${dlv} version`))("Delve (TCP): Go program", async () => {
    const gd = join(dir, "goprog");
    execSync(`mkdir -p ${gd}`);
    writeFileSync(join(gd, "go.mod"), "module example.com/p\n\ngo 1.21\n");
    writeFileSync(join(gd, "main.go"), 'package main\n\nimport "fmt"\n\nfunc double(n int) int {\n\tm := n * 2\n\treturn m\n}\n\nfunc main() {\n\tfmt.Println(double(21))\n}\n');
    const port = await freePort();
    const p = spawn(dlv, ["dap", `--listen=127.0.0.1:${port}`, "--check-go-version=false"], { cwd: gd, stdio: "ignore" });
    const t = await tcpTransport(port);
    const file = join(gd, "main.go");
    const h = harness(file, [7]);
    const s = new DebugSession(new DapClient(t), { name: "go", adapterId: "go", request: "launch", args: { mode: "debug", program: gd } }, h.hooks);
    await s.start().catch((e) => {
      throw new Error(`${e.message}\n${h.output.join("")}`);
    });
    const st = await h.until((x) => x.status === "stopped", 90_000);
    expect(st.frames[0]).toMatchObject({ name: "main.double", line: 7 });
    const vars = await s.variables((await s.scopes(st.frames[0].id))[0].variablesReference);
    expect(vars.find((v) => v.name === "m")?.value).toBe("42");
    await s.continue();
    await h.until((x) => x.status === "ended", 30_000);
    p.kill();
  }, 180_000);
});
