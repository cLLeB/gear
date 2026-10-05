// DAP transports backed by the Rust side: stdio adapters reuse the LSP
// process plumbing (identical Content-Length framing); TCP adapters use
// dap_spawn_tcp.

import { Channel, invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";
import type { DapTransport } from "./dapClient";

type ExitInfo = { code: number | null; output: string; reason: string | null };

function channelTransport(kind: "lsp" | "dap") {
  const decoder = new TextDecoder();
  let onMsg: (m: string) => void = () => {};
  const backlog: string[] = [];
  const closers: ((i: ExitInfo) => void)[] = [];
  let id: number | null = null;
  let closed = false;
  let attached = false;
  const onMessage = new Channel<ArrayBuffer>();
  onMessage.onmessage = (buf) => {
    const text = decoder.decode(buf);
    // Hold messages until the client has attached its handler.
    if (!attached) backlog.push(text);
    else onMsg(text);
  };
  const onExit = new Channel<{ code: number | null; stderrTail?: string; outputTail?: string; reason: string | null }>();
  onExit.onmessage = (i) => {
    closed = true;
    const info = { code: i.code, output: i.stderrTail ?? i.outputTail ?? "", reason: i.reason };
    for (const c of closers) c(info);
  };
  const transport: DapTransport = {
    send: (m) => {
      if (closed || id === null) return;
      void invoke(kind === "lsp" ? "lsp_send" : "dap_send", { id, message: m }).catch(() => {});
    },
    onMessage: (cb) => {
      onMsg = cb;
      attached = true;
      for (const m of backlog.splice(0)) cb(m);
    },
    onClose: (cb) => closers.push(cb),
    close: () => {
      if (id !== null) void invoke(kind === "lsp" ? "lsp_kill" : "dap_kill", { id }).catch(() => {});
      closed = true;
    },
  };
  return {
    transport,
    onMessage,
    onExit,
    ready(newId: number) {
      id = newId;
    },
  };
}

/** Start an adapter that talks DAP on stdin/stdout. */
export async function stdioAdapter(command: string, args: string[], cwd: string, env?: Record<string, string>): Promise<DapTransport> {
  const c = channelTransport("lsp");
  const id = await invoke<number>("lsp_spawn", {
    command,
    args,
    env: env ?? null,
    root: cwd,
    maxRssMb: 16_384,
    workspace: currentWorkspaceEnv(),
    onMessage: c.onMessage,
    onExit: c.onExit,
  });
  c.ready(id);
  return c.transport;
}

/** Start an adapter that listens on a TCP port (`{port}` in args is replaced), or connect to one already running (empty command). */
export async function tcpAdapter(command: string, args: string[], cwd: string, port: number, env?: Record<string, string>): Promise<DapTransport> {
  const c = channelTransport("dap");
  const id = await invoke<number>("dap_spawn_tcp", {
    command,
    args: args.map((a) => a.replace(/\{port\}/g, String(port))),
    env: env ?? null,
    cwd,
    port,
    workspace: currentWorkspaceEnv(),
    onMessage: c.onMessage,
    onExit: c.onExit,
  });
  c.ready(id);
  return c.transport;
}

export function freePort(): Promise<number> {
  return invoke<number>("dap_free_port");
}
