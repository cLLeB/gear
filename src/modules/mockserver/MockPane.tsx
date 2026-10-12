// gear-mock://: a local HTTP server answering from a table of canned routes,
// with a live log of every request it received.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { toolPaneHandle, toolsNative, type MockRequest, type MockRoute } from "@/modules/tools/paneHandle";
import { curlFor, mergeLog, METHODS, parseRoutes, routeProblem, SAMPLE_ROUTES, serializeRoutes, shadowed, statusTone } from "./model";

export const MOCK_PATH = "gear-mock://Mock server";
const STORE_KEY = "gear.mock.routes";
const ROUTE_FILE = "mock-routes.json";

function loadRoutes(): MockRoute[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const r = parseRoutes(raw);
      if (!r.error) return r.routes;
    }
  } catch {
    // Storage unavailable: fall through to the samples.
  }
  return SAMPLE_ROUTES.map((r) => ({ ...r }));
}

interface State {
  routes: MockRoute[];
  port: number | null;
  wantPort: string;
  log: MockRequest[];
  lastSeq: number;
  error: string | null;
}

export const useMock = create<State>(() => ({ routes: loadRoutes(), port: null, wantPort: "4010", log: [], lastSeq: 0, error: null }));

function persist(routes: MockRoute[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(routes));
  } catch {
    // Not fatal: the table still lives in memory.
  }
}

function validRoutes(routes: MockRoute[]): MockRoute[] {
  return routes.filter((r) => !routeProblem(r)).map((r) => ({ ...r, method: r.method.toUpperCase(), headers: r.headers ?? [], body: r.body ?? "" }));
}

export function setRoutes(routes: MockRoute[]): void {
  useMock.setState({ routes });
  persist(routes);
  if (useMock.getState().port !== null) void toolsNative.mockSetRoutes(validRoutes(routes)).catch(() => {});
}

export async function startMock(): Promise<void> {
  const { wantPort, routes } = useMock.getState();
  const port = Number(wantPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return void useMock.setState({ error: "The port must be a number from 0 to 65535 (0 picks a free one)." });
  try {
    const bound = await toolsNative.mockStart(port, validRoutes(routes));
    useMock.setState({ port: bound, wantPort: String(bound), error: null, log: [], lastSeq: 0 });
    toast.success(`Mock server listening on http://127.0.0.1:${bound}`);
  } catch (err) {
    useMock.setState({ error: String(err), port: null });
  }
}

export async function stopMock(): Promise<void> {
  await toolsNative.mockStop();
  useMock.setState({ port: null });
}

export async function pollMock(): Promise<void> {
  const { lastSeq, log } = useMock.getState();
  const s = await toolsNative.mockStatus(lastSeq);
  const top = s.requests.reduce((m, r) => Math.max(m, r.seq), lastSeq);
  useMock.setState({ port: s.port, log: mergeLog(log, s.requests), lastSeq: top });
}

export function openMock(): void {
  app().openFile(MOCK_PATH);
}

function routeFilePath(): string | null {
  const root = app().workspaceRoot();
  return root ? `${root.replace(/[\\/]+$/, "")}/${ROUTE_FILE}` : null;
}

async function saveToFile(): Promise<void> {
  const file = routeFilePath();
  if (!file) return void toast.error("Open a folder first.");
  try {
    await native.writeFile(file, serializeRoutes(useMock.getState().routes), "user");
    toast.success(`Saved ${ROUTE_FILE}`);
  } catch (err) {
    toast.error(`Could not save ${ROUTE_FILE}: ${String(err)}`);
  }
}

async function loadFromFile(): Promise<void> {
  const file = routeFilePath();
  if (!file) return void toast.error("Open a folder first.");
  const r = await native.readFile(file).catch(() => null);
  if (!r || r.kind !== "text") return void toast.error(`No ${ROUTE_FILE} in this folder.`);
  const parsed = parseRoutes(r.content);
  if (parsed.error) return void toast.error(parsed.error);
  setRoutes(parsed.routes);
  toast.success(`Loaded ${parsed.routes.length} routes from ${ROUTE_FILE}`);
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const field = "rounded border border-border/60 bg-background px-1.5 py-0.5 font-mono text-[12px] outline-none focus:border-ring";
const TONE = { ok: "text-emerald-600", redirect: "text-sky-600", client: "text-amber-600", server: "text-red-500" };

export const MockPane = forwardRef<EditorPaneHandle, { path: string }>(function MockPane({ path }, ref) {
  const { routes, port, wantPort, log, error } = useMock();
  const [selected, setSelected] = useState(0);
  const [openReq, setOpenReq] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  useImperativeHandle(ref, () => toolPaneHandle(path, { setQuery, clearQuery: () => setQuery(""), reload: () => (void pollMock(), true) }), [path]);

  useEffect(() => {
    void pollMock();
    const t = setInterval(() => document.visibilityState === "visible" && void pollMock(), 1000);
    return () => clearInterval(t);
  }, []);

  const hidden = useMemo(() => new Set(shadowed(routes)), [routes]);
  const route = routes[Math.min(selected, routes.length - 1)];
  const index = Math.min(selected, routes.length - 1);
  const patch = (p: Partial<MockRoute>) => setRoutes(routes.map((r, i) => (i === index ? { ...r, ...p } : r)));
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? log.filter((r) => `${r.method} ${r.path}?${r.query} ${r.status}`.toLowerCase().includes(q)) : log;
  }, [log, query]);
  const bodyIsJson = (() => {
    const b = route?.body ?? "";
    if (!b.trim() || b.includes("{{")) return true;
    if (!/^\s*[{[]/.test(b)) return true;
    try {
      JSON.parse(b);
      return true;
    } catch {
      return false;
    }
  })();

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 p-2">
        <span className={cn("h-2 w-2 rounded-full", port !== null ? "bg-emerald-500" : "bg-muted-foreground/40")} />
        <span>{port !== null ? "Running on" : "Stopped"}</span>
        {port !== null ? (
          <button type="button" className="font-mono underline-offset-2 hover:underline" title="Copy the address" onClick={() => void navigator.clipboard.writeText(`http://127.0.0.1:${port}`).then(() => toast.success("Address copied"))}>
            http://127.0.0.1:{port}
          </button>
        ) : (
          <>
            <span className="text-muted-foreground">port</span>
            <input className={cn(field, "w-[70px]")} value={wantPort} onChange={(e) => useMock.setState({ wantPort: e.target.value })} onKeyDown={(e) => e.key === "Enter" && void startMock()} />
          </>
        )}
        {port !== null ? (
          <button type="button" className={btn} onClick={() => void stopMock()}>
            Stop
          </button>
        ) : (
          <button type="button" className={cn(btn, "bg-primary/10")} onClick={() => void startMock()}>
            Start
          </button>
        )}
        <span className="flex-1" />
        <button type="button" className={btn} title={`Read ${ROUTE_FILE} from the workspace folder`} onClick={() => void loadFromFile()}>
          Load file
        </button>
        <button type="button" className={btn} title={`Write ${ROUTE_FILE} into the workspace folder`} onClick={() => void saveToFile()}>
          Save file
        </button>
        <button type="button" className={btn} onClick={() => setRoutes(SAMPLE_ROUTES.map((r) => ({ ...r })))}>
          Reset to samples
        </button>
      </div>
      {error && <div className="border-b border-border/60 bg-red-500/10 px-3 py-1.5 text-red-500">{error}</div>}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[46%] min-w-[320px] flex-col border-r border-border/60">
          <div className="flex items-center justify-between border-b border-border/60 px-2 py-1">
            <span className="font-medium">Routes ({routes.length})</span>
            <button
              type="button"
              className={btn}
              onClick={() => {
                setRoutes([...routes, { method: "GET", path: "/new", status: 200, body: "{}", headers: [], delayMs: 0 }]);
                setSelected(routes.length);
              }}
            >
              + Route
            </button>
          </div>
          <div className="max-h-[42%] overflow-auto">
            {routes.map((r, i) => {
              const problem = routeProblem(r);
              return (
                <button key={i} type="button" data-route={i} className={cn("flex w-full items-center gap-2 border-b border-border/30 px-2 py-1 text-left hover:bg-muted/40", i === index && "bg-muted/60")} onClick={() => setSelected(i)}>
                  <span className="w-[58px] font-mono text-[11px] font-semibold">{r.method}</span>
                  <span className="min-w-0 flex-1 truncate font-mono">{r.path}</span>
                  {problem && <span className="rounded bg-red-500/15 px-1 text-[10.5px] text-red-500">invalid</span>}
                  {!problem && hidden.has(i) && (
                    <span className="rounded bg-amber-500/15 px-1 text-[10.5px] text-amber-600" title="An earlier route answers the same requests">
                      never reached
                    </span>
                  )}
                  <span className={cn("tabular-nums", TONE[statusTone(r.status ?? 200)])}>{r.status ?? 200}</span>
                </button>
              );
            })}
            {routes.length === 0 && <div className="p-3 text-muted-foreground">No routes. Every request will get a 404.</div>}
          </div>
          {route && (
            <div className="min-h-0 flex-1 space-y-1.5 overflow-auto border-t border-border/60 p-2">
              <div className="flex items-center gap-1.5">
                <select className={field} value={route.method.toUpperCase()} onChange={(e) => patch({ method: e.target.value })}>
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m === "*" ? "ANY" : m}
                    </option>
                  ))}
                </select>
                <input className={cn(field, "min-w-0 flex-1")} value={route.path} spellCheck={false} placeholder="/users/:id" onChange={(e) => patch({ path: e.target.value })} />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground">Status</span>
                <input className={cn(field, "w-[56px]")} value={String(route.status ?? 200)} onChange={(e) => patch({ status: Number(e.target.value) || 0 })} />
                <span className="text-muted-foreground">Delay (ms)</span>
                <input className={cn(field, "w-[64px]")} value={String(route.delayMs ?? 0)} onChange={(e) => patch({ delayMs: Number(e.target.value) || 0 })} />
                <span className="flex-1" />
                <button type="button" className={btn} disabled={index === 0} title="Earlier routes win" onClick={() => (setRoutes(routes.map((r, i) => (i === index - 1 ? routes[index] : i === index ? routes[index - 1] : r))), setSelected(index - 1))}>
                  ↑
                </button>
                <button type="button" className={btn} disabled={index === routes.length - 1} onClick={() => (setRoutes(routes.map((r, i) => (i === index + 1 ? routes[index] : i === index ? routes[index + 1] : r))), setSelected(index + 1))}>
                  ↓
                </button>
                <button type="button" className={btn} onClick={() => (setRoutes([...routes.slice(0, index + 1), { ...route }, ...routes.slice(index + 1)]), setSelected(index + 1))}>
                  Duplicate
                </button>
                <button type="button" className={btn} onClick={() => (setRoutes(routes.filter((_, i) => i !== index)), setSelected(Math.max(0, index - 1)))}>
                  Delete
                </button>
              </div>
              {routeProblem(route) && <div className="text-red-500">This route is not served: {routeProblem(route)}.</div>}
              <div className="text-muted-foreground">Headers (one per line, Name: value)</div>
              <textarea
                className={cn(field, "h-[46px] w-full resize-y")}
                spellCheck={false}
                value={(route.headers ?? []).map(([k, v]) => `${k}: ${v}`).join("\n")}
                placeholder="Cache-Control: no-store"
                onChange={(e) =>
                  patch({
                    headers: e.target.value
                      .split("\n")
                      .filter((l) => l.trim())
                      .map((l) => {
                        const at = l.indexOf(":");
                        return (at < 0 ? [l.trim(), ""] : [l.slice(0, at).trim(), l.slice(at + 1).trim()]) as [string, string];
                      }),
                  })
                }
              />
              <div className="flex items-center justify-between text-muted-foreground">
                <span>
                  Body — use {"{{params.id}}"}, {"{{query.page}}"}, {"{{body}}"}, {"{{now}}"}, {"{{uuid}}"}
                </span>
                {!bodyIsJson && <span className="text-amber-600">not valid JSON</span>}
              </div>
              <textarea className={cn(field, "h-[150px] w-full resize-y")} spellCheck={false} value={route.body ?? ""} onChange={(e) => patch({ body: e.target.value })} />
              {port !== null && (
                <div className="flex items-center gap-1.5">
                  <code className="min-w-0 flex-1 truncate rounded bg-muted/50 px-1.5 py-0.5 text-[11.5px]">{curlFor(route, port)}</code>
                  <button type="button" className={btn} onClick={() => void navigator.clipboard.writeText(curlFor(route, port)).then(() => toast.success("Copied"))}>
                    Copy
                  </button>
                  <button type="button" className={btn} title="Run it in a terminal" onClick={() => app().openTerminal({ command: curlFor(route, port) })}>
                    Try
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1">
            <span className="font-medium">Requests ({log.length})</span>
            <input className={cn(field, "min-w-0 flex-1")} value={query} placeholder="Filter" onChange={(e) => setQuery(e.target.value)} />
            <button type="button" className={btn} onClick={() => (void toolsNative.mockClearLog(), useMock.setState({ log: [] }))}>
              Clear
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {shown.length === 0 && <div className="p-4 text-muted-foreground">{port === null ? "Start the server, then call it from your app, a browser or curl." : log.length ? "Nothing matches the filter." : "Waiting for the first request…"}</div>}
            {shown.map((r) => (
              <div key={r.seq} className="border-b border-border/30">
                <button type="button" data-req={r.seq} className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-muted/40" onClick={() => setOpenReq(openReq === r.seq ? null : r.seq)}>
                  <span className="w-[62px] tabular-nums text-muted-foreground">{new Date(r.atMs).toLocaleTimeString()}</span>
                  <span className="w-[54px] font-mono text-[11px] font-semibold">{r.method}</span>
                  <span className="min-w-0 flex-1 truncate font-mono">
                    {r.path}
                    {r.query && <span className="text-muted-foreground">?{r.query}</span>}
                  </span>
                  {r.route === null && r.status === 404 && <span className="rounded bg-amber-500/15 px-1 text-[10.5px] text-amber-600">no route</span>}
                  <span className={cn("tabular-nums", TONE[statusTone(r.status)])}>{r.status}</span>
                </button>
                {openReq === r.seq && (
                  <div className="space-y-1 bg-muted/20 px-3 py-1.5 font-mono text-[11.5px]">
                    {r.headers.map(([k, v], i) => (
                      <div key={i} className="break-all">
                        <span className="text-muted-foreground">{k}:</span> {v}
                      </div>
                    ))}
                    {r.body && <pre className="mt-1 max-h-[220px] overflow-auto whitespace-pre-wrap break-all rounded bg-background p-1.5">{r.body}</pre>}
                    {r.route === null && r.status === 404 && (
                      <button
                        type="button"
                        className={cn(btn, "font-sans")}
                        onClick={() => {
                          setRoutes([...routes, { method: r.method, path: r.path, status: 200, body: "{}", headers: [], delayMs: 0 }]);
                          setSelected(routes.length);
                        }}
                      >
                        Add a route for this request
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});
