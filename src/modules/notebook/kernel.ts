// Jupyter kernels without ZeroMQ in the app: a small Python bridge (using
// jupyter_client, which ships with Jupyter / ipykernel) owns the kernel and
// relays messages as Content-Length framed JSON over stdio — the same framing
// as LSP/DAP, so it runs on the existing process transport.

export const BRIDGE = String.raw`
import json, os, sys, threading
try:
    from jupyter_client import KernelManager
    from jupyter_client.kernelspec import KernelSpecManager
except Exception as e:
    sys.stdout.write("Content-Length: %d\r\n\r\n" % 0); sys.stdout.flush()
    sys.stderr.write("jupyter_client is not installed: %s\n" % e)
    sys.exit(3)

lock = threading.Lock()
out = sys.stdout.buffer
inp = sys.stdin.buffer

def send(obj):
    data = json.dumps(obj, default=str).encode("utf-8")
    with lock:
        out.write(b"Content-Length: %d\r\n\r\n" % len(data))
        out.write(data)
        out.flush()

def read():
    length = None
    while True:
        line = inp.readline()
        if not line:
            return None
        line = line.strip()
        if not line:
            if length is not None:
                break
            continue
        k, _, v = line.decode().partition(":")
        if k.strip().lower() == "content-length":
            length = int(v.strip())
    return json.loads(inp.read(length).decode("utf-8"))

specs = KernelSpecManager().get_all_specs()
name = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else "python3"
if name not in specs and specs:
    name = "python3" if "python3" in specs else sorted(specs)[0]
km = KernelManager(kernel_name=name)
km.start_kernel(cwd=os.getcwd())
kc = km.client()
kc.start_channels()
try:
    kc.wait_for_ready(timeout=90)
except Exception as e:
    send({"type": "fatal", "message": "kernel did not start: %s" % e})
    sys.exit(4)

ids = {}
restarts = {}
def pump(get, kind):
    while True:
        try:
            msg = get(timeout=0.5)
        except Exception:
            if not km.is_alive():
                send({"type": "dead"})
                return
            continue
        parent = (msg.get("parent_header") or {}).get("msg_id")
        if parent in restarts:
            # IOPub delivered a message for a post-restart kernel_info: output won't be dropped now.
            if kind == "iopub":
                done = restarts[parent]
                if not done.is_set():
                    done.set()
            continue
        send({"type": kind, "id": ids.get(parent), "msg_type": msg["header"]["msg_type"], "content": msg["content"]})

threading.Thread(target=pump, args=(kc.get_iopub_msg, "iopub"), daemon=True).start()
threading.Thread(target=pump, args=(kc.get_shell_msg, "shell"), daemon=True).start()

info = {"kernel": name, "specs": {k: v["spec"].get("display_name", k) for k, v in specs.items()}, "language": specs.get(name, {}).get("spec", {}).get("language", "python")}
send({"type": "ready", "info": info})

while True:
    req = read()
    if req is None:
        break
    op = req.get("op")
    rid = req.get("id")
    try:
        if op == "execute":
            ids[kc.execute(req["code"], store_history=True, allow_stdin=False, stop_on_error=True)] = rid
        elif op == "complete":
            ids[kc.complete(req["code"], req.get("cursor"))] = rid
        elif op == "inspect":
            ids[kc.inspect(req["code"], req.get("cursor"), detail_level=0)] = rid
        elif op == "interrupt":
            km.interrupt_kernel()
            send({"type": "ack", "id": rid})
        elif op == "restart":
            km.restart_kernel(now=True)
            # Don't call wait_for_ready (the pump thread owns the shell channel):
            # ask for kernel_info and ack when the pump sees the reply.
            def wait_iopub(rid=rid):
                # Like wait_for_ready: repeat kernel_info until IOPub (which reconnects
                # after shell) delivers its status message for one of them.
                done = threading.Event()
                for _ in range(180):
                    restarts[kc.kernel_info()] = done
                    if done.wait(0.5):
                        send({"type": "ack", "id": rid})
                        return
                send({"type": "error", "id": rid, "message": "kernel did not come back after restart"})
            threading.Thread(target=wait_iopub, daemon=True).start()
        elif op == "shutdown":
            break
    except Exception as e:
        send({"type": "error", "id": rid, "message": str(e)})

try:
    kc.stop_channels()
    km.shutdown_kernel(now=True)
except Exception:
    pass
`;

export interface KernelTransport {
  send(message: string): void;
  onMessage(cb: (message: string) => void): void;
  onClose(cb: (info: { code: number | null; output: string; reason: string | null }) => void): void;
  close(): void;
}

export interface KernelInfo {
  kernel: string;
  specs: Record<string, string>;
  language: string;
}

export type KernelStatus = "starting" | "idle" | "busy" | "dead";

interface Pending {
  onIopub: (msgType: string, content: Record<string, unknown>) => void;
  resolve: (reply: Record<string, unknown>) => void;
  reject: (e: Error) => void;
}

/** One running kernel. */
export class KernelSession {
  private seq = 0;
  private pending = new Map<number, Pending>();
  private acks = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();
  private statusCbs = new Set<(s: KernelStatus) => void>();
  info: KernelInfo | null = null;
  status: KernelStatus = "starting";
  readonly ready: Promise<KernelInfo>;

  constructor(private readonly transport: KernelTransport) {
    let resolveReady!: (i: KernelInfo) => void;
    let rejectReady!: (e: Error) => void;
    this.ready = new Promise((res, rej) => {
      resolveReady = res;
      rejectReady = rej;
    });
    this.ready.catch(() => {});
    transport.onMessage((raw) => {
      if (!raw) return;
      let m: { type: string; id?: number | null; msg_type?: string; content?: Record<string, unknown>; info?: KernelInfo; message?: string };
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      if (m.type === "ready" && m.info) {
        this.info = m.info;
        this.setStatus("idle");
        resolveReady(m.info);
      } else if (m.type === "fatal") {
        this.setStatus("dead");
        rejectReady(new Error(m.message ?? "Kernel failed to start"));
      } else if (m.type === "dead") {
        this.setStatus("dead");
        this.failAll(new Error("The kernel died"));
      } else if (m.type === "iopub") {
        if (m.msg_type === "status") {
          const st = String(m.content?.execution_state ?? "");
          if (st === "busy" || st === "idle") this.setStatus(st);
        }
        if (m.id !== null && m.id !== undefined) this.pending.get(m.id)?.onIopub(m.msg_type ?? "", m.content ?? {});
      } else if (m.type === "shell" && m.id !== null && m.id !== undefined) {
        const p = this.pending.get(m.id);
        if (p && /_reply$/.test(m.msg_type ?? "")) {
          this.pending.delete(m.id);
          p.resolve(m.content ?? {});
        }
      } else if (m.type === "ack" && m.id !== null && m.id !== undefined) {
        this.acks.get(m.id)?.resolve();
        this.acks.delete(m.id);
      } else if (m.type === "error" && m.id !== null && m.id !== undefined) {
        const e = new Error(m.message ?? "kernel request failed");
        this.pending.get(m.id)?.reject(e);
        this.pending.delete(m.id);
        this.acks.get(m.id)?.reject(e);
        this.acks.delete(m.id);
      }
    });
    transport.onClose((info) => {
      this.setStatus("dead");
      const err = new Error(info.output.includes("jupyter_client is not installed") ? "Jupyter isn't installed for this Python. Run: pip install ipykernel" : `Kernel bridge exited${info.output ? `: ${info.output.trim().split("\n").slice(-3).join(" ")}` : ""}`);
      rejectReady(err);
      this.failAll(err);
    });
  }

  private failAll(e: Error): void {
    for (const p of this.pending.values()) p.reject(e);
    this.pending.clear();
    for (const a of this.acks.values()) a.reject(e);
    this.acks.clear();
  }

  private setStatus(s: KernelStatus): void {
    if (this.status === "dead" && s !== "dead") return;
    this.status = s;
    for (const cb of this.statusCbs) cb(s);
  }

  onStatus(cb: (s: KernelStatus) => void): () => void {
    this.statusCbs.add(cb);
    return () => this.statusCbs.delete(cb);
  }

  private send(obj: Record<string, unknown>): void {
    this.transport.send(JSON.stringify(obj));
  }

  /** Execute code; `onIopub` receives stream / display / result / error / clear_output messages. */
  execute(code: string, onIopub: Pending["onIopub"]): Promise<{ status: string; execution_count?: number }> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { onIopub, resolve: (r) => resolve(r as { status: string; execution_count?: number }), reject });
      this.send({ op: "execute", id, code });
    });
  }

  complete(code: string, cursor: number): Promise<{ matches: string[]; cursor_start: number; cursor_end: number }> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { onIopub: () => {}, resolve: (r) => resolve(r as { matches: string[]; cursor_start: number; cursor_end: number }), reject });
      this.send({ op: "complete", id, code, cursor });
    });
  }

  private control(op: "interrupt" | "restart"): Promise<void> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.acks.set(id, { resolve, reject });
      this.send({ op, id });
    });
  }

  interrupt(): Promise<void> {
    return this.control("interrupt");
  }

  async restart(): Promise<void> {
    this.setStatus("starting");
    // Outstanding executions never get replies after a restart.
    this.failAll(new Error("Kernel restarted"));
    await this.control("restart");
    this.setStatus("idle");
  }

  shutdown(): void {
    this.send({ op: "shutdown" });
    setTimeout(() => this.transport.close(), 1500);
  }
}
