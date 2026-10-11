// A Debug Adapter Protocol client: request/response correlation, events and
// reverse requests over any message transport (stdio via lsp_spawn, TCP via
// dap_spawn_tcp, or a Node child process in tests).

export interface DapTransport {
  send(message: string): void;
  onMessage(cb: (message: string) => void): void;
  onClose(cb: (info: { code: number | null; output: string; reason: string | null }) => void): void;
  close(): void;
}

export interface DapMessage {
  seq: number;
  type: "request" | "response" | "event";
}

export interface DapRequest extends DapMessage {
  type: "request";
  command: string;
  arguments?: unknown;
}

export interface DapResponse extends DapMessage {
  type: "response";
  request_seq: number;
  success: boolean;
  command: string;
  message?: string;
  body?: unknown;
}

export interface DapEvent extends DapMessage {
  type: "event";
  event: string;
  body?: Record<string, unknown>;
}

export class DapError extends Error {
  constructor(
    message: string,
    readonly command: string,
  ) {
    super(message);
  }
}

/** The most specific error text a failed response carries (`body.error.format` with its variables filled in). */
export function errorText(r: DapResponse): string {
  const err = (r.body as { error?: { format?: string; variables?: Record<string, string> } } | undefined)?.error;
  const detail = err?.format?.replace(/\{(\w+)\}/g, (_, k: string) => err.variables?.[k] ?? `{${k}}`);
  if (detail && r.message && !detail.includes(r.message)) return `${r.message}: ${detail}`;
  return detail || r.message || `${r.command} failed`;
}

type ReverseHandler = (args: unknown) => Promise<unknown> | unknown;

export class DapClient {
  private seq = 1;
  private pending = new Map<number, { resolve: (r: DapResponse) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> | null; command: string }>();
  private eventHandlers = new Map<string, Set<(body: Record<string, unknown>) => void>>();
  private anyEvent = new Set<(e: DapEvent) => void>();
  private reverse = new Map<string, ReverseHandler>();
  private closeHandlers = new Set<(info: { code: number | null; output: string; reason: string | null }) => void>();
  closed = false;

  constructor(private readonly transport: DapTransport) {
    transport.onMessage((raw) => this.dispatch(raw));
    transport.onClose((info) => {
      this.closed = true;
      for (const [, p] of this.pending) {
        if (p.timer) clearTimeout(p.timer);
        p.reject(new DapError(`Debug adapter closed${info.reason ? `: ${info.reason}` : ""}`, p.command));
      }
      this.pending.clear();
      for (const h of this.closeHandlers) h(info);
    });
  }

  private dispatch(raw: string): void {
    let msg: DapResponse | DapEvent | DapRequest;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === "response") {
      const p = this.pending.get(msg.request_seq);
      if (!p) return;
      this.pending.delete(msg.request_seq);
      if (p.timer) clearTimeout(p.timer);
      if (msg.success) p.resolve(msg);
      else p.reject(new DapError(errorText(msg), msg.command));
    } else if (msg.type === "event") {
      for (const h of this.anyEvent) h(msg);
      for (const h of this.eventHandlers.get(msg.event) ?? []) h(msg.body ?? {});
    } else if (msg.type === "request") {
      void this.answer(msg);
    }
  }

  private async answer(req: DapRequest): Promise<void> {
    const h = this.reverse.get(req.command);
    const reply = (success: boolean, body?: unknown, message?: string) =>
      this.write({ seq: this.seq++, type: "response", request_seq: req.seq, command: req.command, success, body, message });
    if (!h) return reply(false, undefined, `Unsupported reverse request ${req.command}`);
    try {
      reply(true, await h(req.arguments));
    } catch (e) {
      reply(false, undefined, e instanceof Error ? e.message : String(e));
    }
  }

  private write(msg: object): void {
    if (this.closed) return;
    this.transport.send(JSON.stringify(msg));
  }

  request<T = unknown>(command: string, args?: unknown, timeoutMs = 30_000): Promise<T> {
    if (this.closed) return Promise.reject(new DapError("Debug adapter is not running", command));
    const seq = this.seq++;
    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => {
        this.pending.delete(seq);
        reject(new DapError(`${command} timed out`, command));
      }, timeoutMs) : null;
      this.pending.set(seq, { resolve: (r) => resolve(r.body as T), reject, timer, command });
      this.write({ seq, type: "request", command, arguments: args });
    });
  }

  on(event: string, cb: (body: Record<string, unknown>) => void): () => void {
    let set = this.eventHandlers.get(event);
    if (!set) this.eventHandlers.set(event, (set = new Set()));
    set.add(cb);
    return () => set!.delete(cb);
  }

  onAny(cb: (e: DapEvent) => void): () => void {
    this.anyEvent.add(cb);
    return () => this.anyEvent.delete(cb);
  }

  onClose(cb: (info: { code: number | null; output: string; reason: string | null }) => void): void {
    this.closeHandlers.add(cb);
  }

  handle(command: string, h: ReverseHandler): void {
    this.reverse.set(command, h);
  }

  /** Resolve on the next `event` (optionally matching), or reject after a timeout. */
  waitFor(event: string, timeoutMs = 30_000, match: (b: Record<string, unknown>) => boolean = () => true): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new DapError(`Timed out waiting for ${event}`, event));
      }, timeoutMs);
      const off = this.on(event, (b) => {
        if (!match(b)) return;
        clearTimeout(timer);
        off();
        resolve(b);
      });
    });
  }

  dispose(): void {
    this.transport.close();
  }
}
