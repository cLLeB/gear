// A JSON-RPC 2.0 connection to one ACP agent process, carried over the
// backend's stdio host (src-tauri/src/modules/acp.rs).

import { Channel, invoke } from "@tauri-apps/api/core";
import type { AgentDef } from "./agents";
import { type InitializeResult, type NewSessionResult, type PermissionOutcome, type PermissionRequest, PROTOCOL_VERSION, type SessionUpdate, type StopReason } from "./protocol";

type AgentOutput = { kind: "message"; line: string } | { kind: "log"; line: string } | { kind: "exit"; code: number | null; stderr: string[] };

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

export interface ClientHandlers {
  onUpdate: (sessionId: string, update: SessionUpdate) => void;
  onPermission: (req: PermissionRequest) => Promise<PermissionOutcome>;
  readTextFile: (path: string, line?: number | null, limit?: number | null) => Promise<string>;
  writeTextFile: (path: string, content: string) => Promise<void>;
  onLog?: (line: string) => void;
  onExit?: (code: number | null, stderr: string[]) => void;
}

let counter = 0;

export class AcpClient {
  readonly id: string;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private exited = false;
  private stderr: string[] = [];
  info: InitializeResult | null = null;

  constructor(
    private readonly def: AgentDef,
    private readonly handlers: ClientHandlers,
  ) {
    this.id = `${def.id}-${Date.now().toString(36)}-${++counter}`;
  }

  get alive(): boolean {
    return !this.exited;
  }

  async start(cwd: string | null): Promise<InitializeResult> {
    const channel = new Channel<AgentOutput>();
    channel.onmessage = (m) => this.onOutput(m);
    await invoke("acp_start", { id: this.id, program: this.def.launch.program, args: this.def.launch.args, cwd, env: null, onOutput: channel });
    this.info = await this.request<InitializeResult>("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
      clientInfo: { name: "gear", title: "Gear", version: "1" },
    });
    return this.info;
  }

  newSession(cwd: string): Promise<NewSessionResult> {
    return this.request<NewSessionResult>("session/new", { cwd, mcpServers: [] });
  }

  authenticate(methodId: string): Promise<unknown> {
    return this.request("authenticate", { methodId });
  }

  async prompt(sessionId: string, prompt: { type: string; [k: string]: unknown }[]): Promise<StopReason> {
    const r = await this.request<{ stopReason: StopReason }>("session/prompt", { sessionId, prompt });
    return r.stopReason;
  }

  cancel(sessionId: string): void {
    this.notify("session/cancel", { sessionId });
  }

  setMode(sessionId: string, modeId: string): Promise<unknown> {
    return this.request("session/set_mode", { sessionId, modeId });
  }

  async stop(): Promise<void> {
    this.failPending(new RpcError("The agent was stopped.", -1));
    this.exited = true;
    await invoke("acp_stop", { id: this.id }).catch(() => {});
  }

  request<T>(method: string, params: unknown): Promise<T> {
    if (this.exited) return Promise.reject(new RpcError(this.exitMessage(), -1));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.send({ jsonrpc: "2.0", id, method, params }).catch((e) => {
        this.pending.delete(id);
        reject(e);
      });
    });
  }

  notify(method: string, params: unknown): void {
    if (!this.exited) void this.send({ jsonrpc: "2.0", method, params }).catch(() => {});
  }

  private send(msg: unknown): Promise<void> {
    return invoke("acp_send", { id: this.id, line: JSON.stringify(msg) });
  }

  private onOutput(m: AgentOutput): void {
    if (m.kind === "log") {
      this.stderr = [...this.stderr.slice(-59), m.line];
      this.handlers.onLog?.(m.line);
      return;
    }
    if (m.kind === "exit") {
      this.exited = true;
      this.stderr = m.stderr.length ? m.stderr : this.stderr;
      this.failPending(new RpcError(this.exitMessage(m.code), -1));
      this.handlers.onExit?.(m.code, this.stderr);
      return;
    }
    let msg: { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string; data?: unknown } };
    try {
      msg = JSON.parse(m.line);
    } catch {
      // Agents occasionally print non-protocol lines to stdout; skip them.
      this.handlers.onLog?.(m.line);
      return;
    }
    if (msg.method && msg.id !== undefined) void this.answer(msg.id, msg.method, msg.params);
    else if (msg.method) this.onNotification(msg.method, msg.params);
    else if (msg.id !== undefined) {
      const p = this.pending.get(Number(msg.id));
      if (!p) return;
      this.pending.delete(Number(msg.id));
      if (msg.error) p.reject(new RpcError(msg.error.message, msg.error.code, msg.error.data));
      else p.resolve(msg.result);
    }
  }

  private onNotification(method: string, params: unknown): void {
    if (method === "session/update") {
      const p = params as { sessionId: string; update: SessionUpdate };
      if (p?.update) this.handlers.onUpdate(p.sessionId, p.update);
    }
  }

  /** Requests the agent makes of Gear. */
  private async answer(id: number | string, method: string, params: unknown): Promise<void> {
    const p = (params ?? {}) as Record<string, unknown>;
    try {
      let result: unknown;
      switch (method) {
        case "session/request_permission":
          result = { outcome: await this.handlers.onPermission(p as unknown as PermissionRequest) };
          break;
        case "fs/read_text_file":
          result = { content: await this.handlers.readTextFile(String(p.path), p.line as number | null, p.limit as number | null) };
          break;
        case "fs/write_text_file":
          await this.handlers.writeTextFile(String(p.path), String(p.content ?? ""));
          result = {};
          break;
        default:
          await this.send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Gear does not support ${method}` } });
          return;
      }
      await this.send({ jsonrpc: "2.0", id, result });
    } catch (e) {
      await this.send({ jsonrpc: "2.0", id, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } }).catch(() => {});
    }
  }

  private failPending(e: Error): void {
    for (const p of this.pending.values()) p.reject(e);
    this.pending.clear();
  }

  private exitMessage(code?: number | null): string {
    const tail = this.stderr.filter((l) => l.trim()).slice(-6).join("\n");
    return `${this.def.name} stopped${code !== undefined && code !== null ? ` (exit code ${code})` : ""}.${tail ? `\n${tail}` : ""}`;
  }
}

/** Reads a text file the way ACP asks: optional 1-based start line and line count. */
export function sliceLines(text: string, line?: number | null, limit?: number | null): string {
  if (!line && !limit) return text;
  const lines = text.split("\n");
  const start = Math.max(0, (line ?? 1) - 1);
  return lines.slice(start, limit ? start + limit : undefined).join("\n");
}
