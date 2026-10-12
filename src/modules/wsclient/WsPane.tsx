// gear-ws://: connect to a WebSocket server, send messages and watch what comes back.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { formatBytes, toolPaneHandle } from "@/modules/tools/paneHandle";
import { append, backoff, checkUrl, describeClose, exportLog, filterLog, hexPreview, parseProtocols, prettyJson, remember, totals, utf8Length, type Direction, type Entry } from "./model";

export const WS_PATH = "gear-ws://WebSocket";
const URLS_KEY = "gear.ws.urls";
const SAVED_KEY = "gear.ws.messages";

type Status = "idle" | "connecting" | "open" | "waiting";

interface State {
  url: string;
  protocols: string;
  status: Status;
  log: Entry[];
  error: string | null;
  autoReconnect: boolean;
  recent: string[];
  saved: string[];
  /** Sub-protocol the server chose. */
  negotiated: string;
}

function stored(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function keep(key: string, list: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // The list then lasts for this session only.
  }
}

export const useWs = create<State>(() => {
  const recent = stored(URLS_KEY);
  return { url: recent[0] ?? "ws://localhost:8080", protocols: "", status: "idle", log: [], error: null, autoReconnect: false, recent, saved: stored(SAVED_KEY), negotiated: "" };
});

let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
/** Set when the user asked to disconnect, so the close is not treated as a drop. */
let closing = false;

function note(dir: Direction, text: string, bytes = 0, binary = false): void {
  useWs.setState((s) => ({ log: append(s.log, { at: Date.now(), dir, text, bytes, binary }) }));
}

export function disconnect(): void {
  closing = true;
  if (retry) clearTimeout(retry);
  retry = null;
  attempts = 0;
  if (socket && socket.readyState <= WebSocket.OPEN) socket.close(1000, "closed by user");
  else useWs.setState({ status: "idle" });
}

export function connect(): void {
  const s = useWs.getState();
  const checked = checkUrl(s.url);
  if ("error" in checked) return void useWs.setState({ error: checked.error });
  const protos = parseProtocols(s.protocols);
  if ("error" in protos) return void useWs.setState({ error: protos.error });
  if (retry) clearTimeout(retry);
  retry = null;
  closing = false;
  if (socket && socket.readyState <= WebSocket.OPEN) socket.close(1000);
  let ws: WebSocket;
  try {
    ws = new WebSocket(checked.url, protos.protocols);
  } catch (err) {
    return void useWs.setState({ error: `Could not open the connection: ${(err as Error).message}`, status: "idle" });
  }
  ws.binaryType = "arraybuffer";
  socket = ws;
  const recent = remember(s.recent, checked.url);
  keep(URLS_KEY, recent);
  useWs.setState({ status: "connecting", error: null, url: checked.url, recent, negotiated: "" });
  note("info", `Connecting to ${checked.url}…`);
  ws.onopen = () => {
    if (socket !== ws) return;
    attempts = 0;
    useWs.setState({ status: "open", negotiated: ws.protocol });
    note("info", `Connected${ws.protocol ? ` (sub-protocol: ${ws.protocol})` : ""}`);
  };
  ws.onmessage = (ev) => {
    if (socket !== ws) return;
    if (typeof ev.data === "string") note("in", ev.data, utf8Length(ev.data));
    else {
      const bytes = new Uint8Array(ev.data as ArrayBuffer);
      note("in", hexPreview(bytes), bytes.length, true);
    }
  };
  ws.onerror = () => {
    if (socket !== ws) return;
    note("error", "Connection error. The server may be down, the address wrong, or plain ws:// to a remote host was blocked — use wss:// for anything but this machine.");
    // Some failures (a blocked address) end the socket without ever sending a close event.
    setTimeout(() => {
      if (socket === ws && ws.readyState === WebSocket.CLOSED) ws.onclose?.call(ws, new CloseEvent("close", { code: 1006 }));
    }, 50);
  };
  ws.onclose = (ev) => {
    if (socket !== ws) return;
    socket = null;
    note(ev.code === 1000 ? "info" : "error", describeClose(ev.code, ev.reason));
    if (!closing && useWs.getState().autoReconnect) {
      attempts++;
      const wait = backoff(attempts);
      useWs.setState({ status: "waiting" });
      note("info", `Reconnecting in ${wait}s (attempt ${attempts})…`);
      retry = setTimeout(connect, wait * 1000);
    } else useWs.setState({ status: "idle" });
  };
}

export function send(text: string): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    toast.info("Not connected.");
    return false;
  }
  socket.send(text);
  note("out", text, utf8Length(text));
  return true;
}

export function openWs(): void {
  app().openFile(WS_PATH);
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const field = "rounded border border-border/60 bg-background px-1.5 py-0.5 font-mono text-[12px] outline-none focus:border-ring";
const DIR: Record<Direction, { mark: string; cls: string }> = { in: { mark: "↓", cls: "text-emerald-600" }, out: { mark: "↑", cls: "text-sky-600" }, info: { mark: "•", cls: "text-muted-foreground" }, error: { mark: "!", cls: "text-red-500" } };

export const WsPane = forwardRef<EditorPaneHandle, { path: string }>(function WsPane({ path }, ref) {
  const s = useWs();
  const [draft, setDraft] = useState('{"type":"ping"}');
  const [query, setQuery] = useState("");
  const [show, setShow] = useState({ in: true, out: true, info: true });
  const [open, setOpen] = useState<number | null>(null);
  const [follow, setFollow] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => toolPaneHandle(path, { setQuery, clearQuery: () => setQuery("") }), [path]);

  const shown = useMemo(() => filterLog(s.log, query, show), [s.log, query, show]);
  const t = useMemo(() => totals(s.log), [s.log]);
  const draftJson = prettyJson(draft);
  const looksJson = /^\s*[{[]/.test(draft);

  useEffect(() => {
    if (follow && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [shown.length, follow]);

  const saveDraft = () => {
    if (!draft.trim()) return;
    const saved = remember(s.saved, draft, 30);
    useWs.setState({ saved });
    keep(SAVED_KEY, saved);
    toast.success("Message saved");
  };

  const connected = s.status === "open";

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 p-2">
        <span className={cn("h-2 w-2 rounded-full", connected ? "bg-emerald-500" : s.status === "idle" ? "bg-muted-foreground/40" : "bg-amber-500")} data-ws-status={s.status} />
        <input className={cn(field, "min-w-[220px] flex-1")} list="gear-ws-urls" value={s.url} spellCheck={false} disabled={s.status !== "idle"} placeholder="ws://localhost:8080 or wss://example.org/socket" onChange={(e) => useWs.setState({ url: e.target.value })} onKeyDown={(e) => e.key === "Enter" && connect()} />
        <datalist id="gear-ws-urls">
          {s.recent.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
        <input className={cn(field, "w-[150px]")} value={s.protocols} spellCheck={false} disabled={s.status !== "idle"} placeholder="sub-protocols" title="Optional, comma separated" onChange={(e) => useWs.setState({ protocols: e.target.value })} />
        {s.status === "idle" ? (
          <button type="button" className={cn(btn, "bg-primary/10")} onClick={connect}>
            Connect
          </button>
        ) : (
          <button type="button" className={btn} onClick={disconnect}>
            {s.status === "open" ? "Disconnect" : "Cancel"}
          </button>
        )}
        <label className="flex items-center gap-1" title="Reconnect with growing pauses when the connection drops">
          <input type="checkbox" checked={s.autoReconnect} onChange={(e) => useWs.setState({ autoReconnect: e.target.checked })} />
          Reconnect
        </label>
      </div>
      {s.error && <div className="border-b border-border/60 bg-red-500/10 px-3 py-1.5 text-red-500">{s.error}</div>}
      <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1">
        <span className="text-muted-foreground">
          ↑ {t.sent} ({formatBytes(t.bytesOut)}) · ↓ {t.received} ({formatBytes(t.bytesIn)})
        </span>
        <span className="flex-1" />
        {(["out", "in", "info"] as const).map((k) => (
          <button key={k} type="button" className={cn(btn, show[k] && "bg-muted font-medium")} onClick={() => setShow({ ...show, [k]: !show[k] })}>
            {k === "out" ? "Sent" : k === "in" ? "Received" : "Events"}
          </button>
        ))}
        <input className={cn(field, "w-[170px]")} value={query} placeholder="Filter" onChange={(e) => setQuery(e.target.value)} />
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          Follow
        </label>
        <button type="button" className={btn} disabled={!s.log.length} onClick={() => void navigator.clipboard.writeText(exportLog(shown)).then(() => toast.success("Log copied"))}>
          Copy log
        </button>
        <button type="button" className={btn} disabled={!s.log.length} onClick={() => useWs.setState({ log: [] })}>
          Clear
        </button>
      </div>
      <div ref={logRef} className="min-h-0 flex-1 overflow-auto font-mono text-[12px]" data-ws-log>
        {shown.length === 0 && <div className="p-4 font-sans text-muted-foreground">{s.log.length ? "Nothing matches the filter." : "Enter an address and connect. Messages you send and receive appear here."}</div>}
        {shown.slice(-1000).map((e) => {
          const pretty = e.dir === "in" || e.dir === "out" ? prettyJson(e.text) : null;
          return (
            <div key={e.id} className="border-b border-border/20">
              <button type="button" className="flex w-full items-start gap-2 px-2 py-0.5 text-left hover:bg-muted/40" onClick={() => setOpen(open === e.id ? null : e.id)}>
                <span className="w-[64px] shrink-0 tabular-nums text-muted-foreground">{new Date(e.at).toLocaleTimeString()}</span>
                <span className={cn("w-3 shrink-0 text-center font-bold", DIR[e.dir].cls)}>{DIR[e.dir].mark}</span>
                <span className={cn("min-w-0 flex-1 truncate", (e.dir === "info" || e.dir === "error") && cn("font-sans", DIR[e.dir].cls))}>
                  {e.binary && <span className="mr-1 rounded bg-muted px-1 font-sans text-[10.5px]">binary</span>}
                  {e.text}
                </span>
                {(e.dir === "in" || e.dir === "out") && <span className="shrink-0 tabular-nums text-muted-foreground">{formatBytes(e.bytes)}</span>}
              </button>
              {open === e.id && (
                <div className="bg-muted/20 px-3 py-1.5">
                  <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap break-all">{pretty ?? e.text}</pre>
                  <div className="mt-1 flex gap-1 font-sans">
                    <button type="button" className={btn} onClick={() => void navigator.clipboard.writeText(e.text).then(() => toast.success("Copied"))}>
                      Copy
                    </button>
                    {e.dir === "out" && (
                      <button type="button" className={btn} onClick={() => setDraft(e.text)}>
                        Edit and resend
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="border-t border-border/60 p-2">
        <textarea
          className={cn(field, "h-[84px] w-full resize-y")}
          spellCheck={false}
          value={draft}
          placeholder="Message — Ctrl+Enter to send"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) (e.preventDefault(), send(draft));
          }}
        />
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <button type="button" className={cn(btn, connected && "bg-primary/10")} disabled={!connected || !draft} onClick={() => send(draft)}>
            Send
          </button>
          <button type="button" className={btn} disabled={!draftJson} onClick={() => draftJson && setDraft(draftJson)}>
            Format JSON
          </button>
          <button type="button" className={btn} disabled={!draftJson} title="Remove whitespace" onClick={() => draftJson && setDraft(JSON.stringify(JSON.parse(draft)))}>
            Minify
          </button>
          <button type="button" className={btn} disabled={!draft.trim()} onClick={saveDraft}>
            Save message
          </button>
          {s.saved.length > 0 && (
            <select className={field} value="" onChange={(e) => e.target.value && setDraft(e.target.value)}>
              <option value="">Saved messages ({s.saved.length})…</option>
              {s.saved.map((m) => (
                <option key={m} value={m}>
                  {m.replace(/\s+/g, " ").slice(0, 60)}
                </option>
              ))}
            </select>
          )}
          <span className="flex-1" />
          {looksJson && !draftJson && <span className="text-amber-600">not valid JSON</span>}
          <span className="text-muted-foreground">{formatBytes(utf8Length(draft))}</span>
          {s.negotiated && <span className="text-muted-foreground">sub-protocol: {s.negotiated}</span>}
        </div>
      </div>
    </div>
  );
});

export const WS_ACTIONS = [{ id: "ws.open", label: "WebSocket: Open the WebSocket client", keywords: ["websocket", "ws", "wss", "socket", "realtime", "client", "send", "messages"], run: openWs }];
