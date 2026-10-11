// Drives a real IPython kernel through the bridge (skipped without jupyter_client + ipykernel).

import { execSync, spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { BRIDGE, KernelSession, type KernelTransport } from "./kernel";
import { applyIopub, type OutputState } from "./model";

function has(): boolean {
  try {
    execSync(`python3 -c "import jupyter_client, ipykernel"`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function bridge(): KernelTransport {
  const p = spawn("python3", ["-u", "-c", BRIDGE, "python3"], { stdio: ["pipe", "pipe", "pipe"] });
  let buf = Buffer.alloc(0);
  let handler: (m: string) => void = () => {};
  let stderr = "";
  p.stderr!.on("data", (d) => (stderr += d));
  p.stdout!.on("data", (chunk: Buffer) => {
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
  p.on("exit", (code) => closers.forEach((c) => c({ code, output: stderr, reason: null })));
  return {
    send: (m) => p.stdin!.write(`Content-Length: ${Buffer.byteLength(m)}\r\n\r\n${m}`),
    onMessage: (cb) => (handler = cb),
    onClose: (cb) => closers.push(cb),
    close: () => p.kill(),
  };
}

async function run(k: KernelSession, code: string): Promise<{ reply: { status: string; execution_count?: number }; state: OutputState }> {
  let state: OutputState = { outputs: [], clearPending: false };
  const reply = await k.execute(code, (t, c) => {
    const next = applyIopub(state, t, c);
    if (next) state = next;
  });
  // iopub can trail the shell reply slightly.
  await new Promise((r) => setTimeout(r, 150));
  return { reply, state };
}

describe.skipIf(!has())("Jupyter kernel bridge", () => {
  it("executes, streams, errors, interrupts and restarts", async () => {
    const k = new KernelSession(bridge());
    const info = await k.ready;
    expect(info.kernel).toBe("python3");
    expect(info.language).toBe("python");

    const a = await run(k, "import sys\nprint('hello')\nprint('err', file=sys.stderr)\nx = 20\nx + 22");
    expect(a.reply.status).toBe("ok");
    expect(a.state.outputs.map((o) => o.output_type)).toEqual(["stream", "stream", "execute_result"]);
    expect(a.state.outputs[0]).toMatchObject({ name: "stdout", text: "hello\n" });
    expect(a.state.outputs[2]).toMatchObject({ data: { "text/plain": "42" }, execution_count: a.reply.execution_count });

    const b = await run(k, "for i in range(3):\n    print(i, end='\\r')\nprint('done')");
    expect(b.state.outputs).toEqual([{ output_type: "stream", name: "stdout", text: "done\n" }]);

    const c = await run(k, "1/0");
    expect(c.reply.status).toBe("error");
    expect(c.state.outputs[0]).toMatchObject({ output_type: "error", ename: "ZeroDivisionError" });

    const d = await run(k, "from IPython.display import display, HTML, clear_output\nh = display(HTML('<b>one</b>'), display_id=True)\nh.update(HTML('<b>two</b>'))");
    expect(d.state.outputs).toHaveLength(1);
    expect((d.state.outputs[0] as { data: Record<string, string> }).data["text/html"]).toBe("<b>two</b>");

    const e = await run(k, "print('a')\nclear_output(wait=True)\nprint('b')");
    expect(e.state.outputs).toEqual([{ output_type: "stream", name: "stdout", text: "b\n" }]);

    const sleeping = run(k, "import time\ntime.sleep(30)");
    await new Promise((r) => setTimeout(r, 800));
    await k.interrupt();
    const s = await sleeping;
    expect(s.reply.status).toBe("error");
    expect(s.state.outputs.some((o) => o.output_type === "error" && o.ename === "KeyboardInterrupt")).toBe(true);

    const comp = await k.complete("import os\nos.pa", 15);
    expect(comp.matches.some((m) => m.endsWith("path"))).toBe(true);

    await k.restart();
    const f = await run(k, "'x' in dir()");
    expect((f.state.outputs[0] as { data: Record<string, string> }).data["text/plain"]).toBe("False");
    k.shutdown();
  }, 120_000);
});
