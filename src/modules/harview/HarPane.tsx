// .har files (or gear-har://<file>): the network log a browser saved, as a
// filterable request list with a waterfall, request details, a summary of
// what the page loaded, and a redacted copy that is safe to share.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { app, frontFilePath } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { inputBox } from "@/modules/quick-pick";
import { base64ToBytes, bytesToBase64, formatBytes, toolPaneHandle, toolsNative } from "@/modules/tools/paneHandle";
import { filterRequests, formatMs, parseHar, phases, redactHar, statusClass, summarize, toCurl, toFetch, type Har, type Kind, type Request, type StatusFilter, type Timings } from "./model";

const SCHEME = "gear-har://";
const READ_CAP = 256 * 1024 * 1024;
const ROW_H = 22;

export function openHarFor(file: string): void {
  app().openFile(/\.har$/i.test(file) ? file : `${SCHEME}${file}`);
}

export async function openHarViewer(): Promise<void> {
  const current = frontFilePath() ?? getActiveEditor()?.path ?? "";
  const file = await inputBox({ title: "Open a HAR file", value: /\.har$/i.test(current) ? current : "", placeholder: "Path to a .har file (Network panel → Save all as HAR)" });
  if (file?.trim()) openHarFor(file.trim());
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const KINDS: { kind: Kind; label: string }[] = [
  { kind: "document", label: "Doc" },
  { kind: "fetch", label: "Fetch/XHR" },
  { kind: "script", label: "JS" },
  { kind: "style", label: "CSS" },
  { kind: "image", label: "Img" },
  { kind: "font", label: "Font" },
  { kind: "media", label: "Media" },
  { kind: "websocket", label: "WS" },
  { kind: "other", label: "Other" },
];
const PHASE_COLOR: Record<keyof Timings, string> = {
  blocked: "bg-zinc-400/60",
  dns: "bg-teal-500",
  connect: "bg-orange-400",
  ssl: "bg-purple-500",
  send: "bg-sky-400",
  wait: "bg-emerald-500",
  receive: "bg-blue-600",
};
const PHASE_LABEL: Record<keyof Timings, string> = { blocked: "Queued / blocked", dns: "DNS lookup", connect: "Connecting", ssl: "TLS handshake", send: "Sending", wait: "Waiting for the server", receive: "Downloading" };

function statusColor(s: number): string {
  const c = statusClass(s);
  return c === "ok" ? "" : c === "redirect" ? "text-sky-600" : c === "client" ? "text-amber-600" : "text-red-500";
}

const size = (n: number) => (n < 0 ? "—" : formatBytes(n));

function prettyBody(r: Request): string {
  if (r.body === null) return "";
  if (/json/i.test(r.mime)) {
    try {
      return JSON.stringify(JSON.parse(r.body), null, 2);
    } catch {
      // Shown as it came.
    }
  }
  return r.body;
}

function HeaderTable({ rows }: { rows: { name: string; value: string }[] }) {
  if (!rows.length) return <div className="text-muted-foreground">None</div>;
  return (
    <table className="w-full border-collapse font-mono text-[11.5px]">
      <tbody>
        {rows.map((h, i) => (
          <tr key={i} className="border-b border-border/30 align-top">
            <td className="whitespace-nowrap py-0.5 pr-3 text-muted-foreground">{h.name}</td>
            <td className="break-all py-0.5">{h.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type Tab = "headers" | "payload" | "response" | "timing";

export const HarPane = forwardRef<EditorPaneHandle, { path: string }>(function HarPane({ path }, ref) {
  const file = path.startsWith(SCHEME) ? path.slice(SCHEME.length) : path;
  const [har, setHar] = useState<Har | null>(null);
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [kinds, setKinds] = useState<Set<Kind>>(new Set());
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("headers");
  const [showSummary, setShowSummary] = useState(false);
  const [dropBodies, setDropBodies] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const scroller = useRef<HTMLDivElement>(null);
  const live = useRef({ text });
  live.current.text = text;

  const load = useCallback(async () => {
    try {
      const r = await toolsNative.readBytes(file, READ_CAP);
      if (r.truncated) throw new Error(`This HAR file is ${formatBytes(r.size)}; files over ${formatBytes(READ_CAP)} are not opened.`);
      const content = new TextDecoder().decode(base64ToBytes(r.data));
      setHar(parseHar(content));
      setRaw(content);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [file]);
  useEffect(() => void load(), [load]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setHeight(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [har === null, showSummary]);

  useImperativeHandle(
    ref,
    () =>
      toolPaneHandle(path, {
        setQuery: (q) => setText(q),
        clearQuery: () => setText(""),
        reload: () => (void load(), true),
        getSelection: () => live.current.text || null,
      }),
    [path, load],
  );

  const rows = useMemo(() => (har ? filterRequests(har.requests, { text, kinds, status }) : []), [har, text, kinds, status]);
  const summary = useMemo(() => summarize(rows), [rows]);
  const span = Math.max(1, ...rows.map((r) => r.start + r.time));
  const current = har && selected !== null ? (har.requests.find((r) => r.index === selected) ?? null) : null;
  const page = har?.pages[0];

  const move = (delta: number) => {
    if (!rows.length) return;
    const at = rows.findIndex((r) => r.index === selected);
    const next = rows[Math.max(0, Math.min(rows.length - 1, at < 0 ? 0 : at + delta))];
    setSelected(next.index);
    const el = scroller.current;
    const i = rows.indexOf(next);
    if (el && (i * ROW_H < el.scrollTop || (i + 1) * ROW_H > el.scrollTop + el.clientHeight)) el.scrollTop = i * ROW_H - el.clientHeight / 2;
  };

  const copy = (value: string, what: string) => void navigator.clipboard.writeText(value).then(() => toast.success(`${what} copied`));

  const saveRedacted = async () => {
    try {
      const { json, masked } = redactHar(raw, { bodies: dropBodies });
      const target = file.replace(/(\.har)?$/i, ".redacted.har");
      await toolsNative.writeBytes(target, bytesToBase64(new TextEncoder().encode(json)));
      toast.success(`Saved ${target.split(/[\\/]/).pop()} with ${masked} value${masked === 1 ? "" : "s"} removed`);
      openHarFor(target);
    } catch (err) {
      toast.error(`Could not save: ${String(err)}`);
    }
  };

  if (error) return <div className="p-6 text-[12.5px] text-red-500" data-har-error>{error}</div>;
  if (!har) return <div className="p-6 text-[12.5px] text-muted-foreground">Reading…</div>;

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 10);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_H) + 10);

  return (
    <div
      className="flex h-full flex-col text-[12.5px] outline-none"
      tabIndex={-1}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).tagName === "INPUT") return;
        if (e.key === "ArrowDown" || e.key === "j") (e.preventDefault(), move(1));
        else if (e.key === "ArrowUp" || e.key === "k") (e.preventDefault(), move(-1));
        else if (e.key === "Escape") setSelected(null);
      }}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border/60 p-2">
        <input
          className="w-[300px] rounded border border-border/60 bg-background px-2 py-0.5 outline-none focus:border-ring"
          data-har-filter
          value={text}
          placeholder="Filter — method:POST status:4xx domain:*.api.com larger-than:100k -word"
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex flex-wrap gap-0.5">
          <button type="button" className={cn(btn, kinds.size === 0 && "bg-muted font-medium")} onClick={() => setKinds(new Set())}>
            All
          </button>
          {KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              data-har-kind={k.kind}
              className={cn(btn, kinds.has(k.kind) && "bg-muted font-medium")}
              onClick={(e) => {
                const next = new Set(e.ctrlKey || e.metaKey ? kinds : []);
                if (kinds.has(k.kind) && (e.ctrlKey || e.metaKey)) next.delete(k.kind);
                else next.add(k.kind);
                setKinds(next);
              }}
              title="Ctrl+click to pick several"
            >
              {k.label}
            </button>
          ))}
        </div>
        <select className="rounded border border-border/60 bg-background px-1 py-0.5 text-[11.5px]" data-har-status value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="all">Any status</option>
          <option value="ok">2xx</option>
          <option value="redirect">3xx</option>
          <option value="client">4xx</option>
          <option value="server">5xx</option>
          <option value="failed">Failed / blocked</option>
        </select>
        <span className="flex-1" />
        <button type="button" className={cn(btn, showSummary && "bg-muted font-medium")} data-har-summary-toggle onClick={() => setShowSummary(!showSummary)}>
          Summary
        </button>
        <label className="flex items-center gap-1 text-[11.5px] text-muted-foreground" title="Also empty request and response bodies, which may hold personal data">
          <input type="checkbox" checked={dropBodies} onChange={(e) => setDropBodies(e.target.checked)} />
          and bodies
        </label>
        <button type="button" className={btn} data-har-redact title="Writes a copy without cookies, auth headers and secret-looking query parameters" onClick={() => void saveRedacted()}>
          Save redacted copy
        </button>
      </div>
      <div className="flex gap-4 border-b border-border/60 px-3 py-1 text-muted-foreground" data-har-totals>
        <span>
          {rows.length === har.requests.length ? `${rows.length} requests` : `${rows.length} of ${har.requests.length} requests`}
        </span>
        <span>{formatBytes(summary.transferred)} transferred</span>
        <span>{formatBytes(summary.size)} resources</span>
        <span>{formatMs(summary.span)}</span>
        {page?.onContentLoad != null && <span className="text-blue-600">DOMContentLoaded {formatMs(page.onContentLoad)}</span>}
        {page?.onLoad != null && <span className="text-red-500">Load {formatMs(page.onLoad)}</span>}
        <span className="flex-1" />
        {har.creator && <span>Recorded with {har.creator}</span>}
      </div>
      {showSummary ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-3 md:grid-cols-2" data-har-summary>
          <section>
            <div className="mb-1 font-medium">By type</div>
            {summary.byKind.map((k) => (
              <div key={k.kind} className="flex gap-2 py-0.5">
                <span className="w-24">{KINDS.find((x) => x.kind === k.kind)?.label}</span>
                <span className="w-16 text-right tabular-nums">{k.count}</span>
                <span className="flex-1">
                  <span className="inline-block h-2 rounded bg-sky-500/70 align-middle" style={{ width: `${summary.transferred ? (k.transferred / summary.transferred) * 100 : 0}%` }} />
                </span>
                <span className="w-20 text-right tabular-nums">{formatBytes(k.transferred)}</span>
              </div>
            ))}
          </section>
          <section>
            <div className="mb-1 font-medium">By domain</div>
            {summary.byHost.slice(0, 15).map((h) => (
              <button key={h.host} type="button" className="flex w-full gap-2 rounded py-0.5 text-left hover:bg-muted/50" onClick={() => (setText(`domain:${h.host}`), setShowSummary(false))}>
                <span className="min-w-0 flex-1 truncate">{h.host}</span>
                <span className="w-12 text-right tabular-nums">{h.count}</span>
                <span className="w-20 text-right tabular-nums">{formatBytes(h.transferred)}</span>
              </button>
            ))}
          </section>
          {[
            { title: "Slowest", list: summary.slowest, value: (r: Request) => formatMs(r.time) },
            { title: "Largest", list: summary.largest, value: (r: Request) => size(Math.max(r.transferred, r.size)) },
          ].map((s) => (
            <section key={s.title}>
              <div className="mb-1 font-medium">{s.title}</div>
              {s.list.map((r) => (
                <button key={r.index} type="button" className="flex w-full gap-2 rounded py-0.5 text-left hover:bg-muted/50" onClick={() => (setSelected(r.index), setShowSummary(false))}>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{r.url}</span>
                  <span className="w-20 text-right tabular-nums">{s.value(r)}</span>
                </button>
              ))}
            </section>
          ))}
          <section className="md:col-span-2">
            <div className="mb-1 font-medium">Requested more than once</div>
            {summary.duplicates.length === 0 && <div className="text-muted-foreground">No duplicate requests.</div>}
            {summary.duplicates.slice(0, 20).map((d) => (
              <div key={`${d.method} ${d.url}`} className="flex gap-2 py-0.5" data-har-duplicate>
                <span className="w-10 tabular-nums">×{d.count}</span>
                <span className="w-14 text-muted-foreground">{d.method}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{d.url}</span>
              </div>
            ))}
            {summary.cached > 0 && <div className="mt-2 text-muted-foreground">{summary.cached} requests were served from a cache.</div>}
          </section>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex border-b border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
              <span className="w-12">Status</span>
              <span className="w-14">Method</span>
              <span className="min-w-0 flex-1">URL</span>
              <span className="w-16">Type</span>
              <span className="w-16 text-right">Size</span>
              <span className="w-16 text-right">Time</span>
              <span className={cn("ml-2", current ? "hidden" : "w-[28%]")}>Waterfall</span>
            </div>
            <div ref={scroller} className="min-h-0 flex-1 overflow-auto" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
              {rows.length === 0 && <div className="p-3 text-muted-foreground">No requests match.</div>}
              <div style={{ height: rows.length * ROW_H, position: "relative" }}>
                {rows.slice(first, last).map((r, i) => (
                  <button
                    key={r.index}
                    type="button"
                    data-har-row={r.index}
                    className={cn("absolute left-0 right-0 flex items-center px-2 text-left hover:bg-muted/50", r.index === selected && "bg-muted", r.fromCache && "opacity-70")}
                    style={{ top: (first + i) * ROW_H, height: ROW_H }}
                    onClick={() => setSelected(r.index === selected ? null : r.index)}
                    title={r.url}
                  >
                    <span className={cn("w-12 tabular-nums", statusColor(r.status))}>{r.status || "—"}</span>
                    <span className="w-14 text-muted-foreground">{r.method}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-muted-foreground">{r.host}</span>
                      <span className="font-mono text-[11.5px]">{r.path || r.url}</span>
                    </span>
                    <span className="w-16 text-muted-foreground">{KINDS.find((k) => k.kind === r.kind)?.label}</span>
                    <span className="w-16 text-right tabular-nums">{r.fromCache && r.transferred <= 0 ? "cache" : size(r.transferred)}</span>
                    <span className="w-16 text-right tabular-nums">{formatMs(r.time)}</span>
                    {!current && (
                      <span className="relative ml-2 h-2.5 w-[28%]">
                        {phases(r).map((p) => (
                          <span key={p.phase} className={cn("absolute top-0 h-full", PHASE_COLOR[p.phase])} style={{ left: `${(p.from / span) * 100}%`, width: `max(1px, ${(p.width / span) * 100}%)` }} />
                        ))}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {current && (
            <div className="flex w-[48%] min-w-[340px] flex-col border-l border-border/60" data-har-detail>
              <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1">
                {(["headers", "payload", "response", "timing"] as Tab[]).map((t) => (
                  <button key={t} type="button" data-har-tab={t} className={cn(btn, tab === t && "bg-muted font-medium")} onClick={() => setTab(t)}>
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
                <span className="flex-1" />
                <button type="button" className={btn} data-har-curl onClick={() => copy(toCurl(current), "curl command")}>
                  Copy as curl
                </button>
                <button type="button" className={btn} onClick={() => copy(toFetch(current), "fetch() call")}>
                  as fetch
                </button>
                <button type="button" className="px-1 text-muted-foreground hover:text-foreground" title="Close (Esc)" onClick={() => setSelected(null)}>
                  ✕
                </button>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
                {tab === "headers" && (
                  <>
                    <div className="space-y-0.5">
                      <div className="break-all font-mono text-[11.5px]">
                        <span className="font-medium">{current.method}</span> {current.url}
                      </div>
                      <div>
                        Status <span className={statusColor(current.status)}>{current.status ? `${current.status} ${current.statusText}` : "no response (blocked, cancelled or failed)"}</span>
                        {current.httpVersion && <span className="text-muted-foreground"> · {current.httpVersion}</span>}
                        {current.serverIp && <span className="text-muted-foreground"> · {current.serverIp}</span>}
                        {current.fromCache && <span className="text-muted-foreground"> · from cache</span>}
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 font-medium">Response headers</div>
                      <HeaderTable rows={current.responseHeaders} />
                    </div>
                    <div>
                      <div className="mb-1 font-medium">Request headers</div>
                      <HeaderTable rows={current.requestHeaders} />
                    </div>
                  </>
                )}
                {tab === "payload" && (
                  <>
                    <div>
                      <div className="mb-1 font-medium">Query string</div>
                      <HeaderTable rows={current.query} />
                    </div>
                    <div>
                      <div className="mb-1 font-medium">Body {current.postData?.mime && <span className="font-normal text-muted-foreground">({current.postData.mime})</span>}</div>
                      {current.postData?.text ? <pre className="whitespace-pre-wrap break-all rounded bg-muted/40 p-2 font-mono text-[11.5px]">{current.postData.text}</pre> : <div className="text-muted-foreground">None</div>}
                    </div>
                  </>
                )}
                {tab === "response" &&
                  (current.body === null || current.body === "" ? (
                    <div className="text-muted-foreground">The file holds no body for this response{current.size > 0 ? ` (${formatBytes(current.size)} were received)` : ""}.</div>
                  ) : current.bodyEncoding === "base64" ? (
                    current.kind === "image" ? (
                      <img alt="" className="max-w-full border border-border/60" src={`data:${current.mime.split(";")[0]};base64,${current.body}`} />
                    ) : (
                      <div className="text-muted-foreground">Binary body ({current.mime || "unknown type"}, {formatBytes(current.size)}).</div>
                    )
                  ) : current.kind === "image" && /svg/i.test(current.mime) ? (
                    <img alt="" className="max-w-full border border-border/60" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(current.body)}`} />
                  ) : (
                    <>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span>
                          {current.mime || "unknown type"} · {formatBytes(current.body.length)}
                        </span>
                        <button type="button" className={btn} onClick={() => copy(current.body ?? "", "Response body")}>
                          Copy
                        </button>
                      </div>
                      <pre className="whitespace-pre-wrap break-all rounded bg-muted/40 p-2 font-mono text-[11.5px]" data-har-body>
                        {prettyBody(current).slice(0, 200_000)}
                      </pre>
                    </>
                  ))}
                {tab === "timing" && (
                  <div className="space-y-1" data-har-timing>
                    <div className="text-muted-foreground">Started {formatMs(current.start)} after the first request</div>
                    {(Object.keys(PHASE_LABEL) as (keyof Timings)[]).map((p) => {
                      const total = Math.max(1, current.time);
                      return (
                        <div key={p} className="flex items-center gap-2">
                          <span className="w-44">{PHASE_LABEL[p]}</span>
                          <span className="relative h-2.5 flex-1 rounded bg-muted/40">
                            <span className={cn("absolute top-0 h-full rounded", PHASE_COLOR[p])} style={{ width: `${Math.min(100, (current.timings[p] / total) * 100)}%` }} />
                          </span>
                          <span className="w-16 text-right tabular-nums">{formatMs(current.timings[p])}</span>
                        </div>
                      );
                    })}
                    <div className="flex justify-between border-t border-border/40 pt-1 font-medium">
                      <span>Total</span>
                      <span className="tabular-nums">{formatMs(current.time)}</span>
                    </div>
                    {current.timings.wait > 500 && <div className="rounded bg-amber-500/10 px-2 py-1 text-amber-600">The server took {formatMs(current.timings.wait)} to start answering; the time is spent on the server, not the network.</div>}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export const HAR_ACTIONS = [
  { id: "har.open", label: "HAR: Open a browser network log (.har)…", keywords: ["har", "network", "http archive", "waterfall", "requests", "devtools", "chrome", "firefox"], run: () => void openHarViewer() },
];
