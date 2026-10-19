// gear-nginx://<nginx.conf>: an nginx configuration with its includes as a
// tree of servers and locations, a request tester that shows which server
// and location answer a URL and what they serve, and the mistakes found.

import { invoke } from "@tauri-apps/api/core";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { app, frontFilePath } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { inputBox, quickPick } from "@/modules/quick-pick";
import { toolPaneHandle } from "@/modules/tools/paneHandle";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { lintNginx, loadConfig, NginxSyntaxError, route, serversOf, type Directive, type Issue, type Location, type Outcome, type Request } from "./model";

const SCHEME = "gear-nginx://";
const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const SEV_STYLE: Record<Issue["severity"], string> = { danger: "bg-red-500/15 text-red-600", warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400", info: "bg-sky-500/15 text-sky-600" };
const CONF = /(^|\/)(nginx\.conf|[^/]+\.conf|sites-(enabled|available)\/[^/]+)$/;

export function openNginxFor(file: string): void {
  app().openFile(`${SCHEME}${file}`);
}

export async function openNginxExplorer(): Promise<void> {
  const current = frontFilePath() ?? getActiveEditor()?.path ?? "";
  const root = app().workspaceRoot();
  const items: { label: string; description?: string; value: string }[] = [];
  if (/\.conf$|nginx/i.test(current) && !current.includes("://")) items.push({ label: current.split(/[\\/]/).pop() ?? current, description: "Current file", value: current });
  if (root) {
    const listed = await invoke<{ files: string[] }>("fs_list_files", { root, limit: 10000, maxDepth: 10, workspace: currentWorkspaceEnv() }).catch(() => ({ files: [] as string[] }));
    const files = listed.files.map((f) => f.replace(/\\/g, "/")).filter((f) => CONF.test(f) && (/nginx/i.test(f) || /(^|\/)(conf\.d|sites-)/.test(f)));
    // nginx.conf first: it is the entry point that includes the rest.
    files.sort((a, b) => Number(!/nginx\.conf$/.test(a)) - Number(!/nginx\.conf$/.test(b)) || a.localeCompare(b));
    for (const f of files.slice(0, 50)) items.push({ label: f, description: /nginx\.conf$/.test(f) ? "entry point" : undefined, value: `${root.replace(/[\\/]+$/, "")}/${f}` });
  }
  items.push({ label: "Other file…", value: "" });
  const pick = items.length > 1 ? await quickPick(items, { title: "Explore an nginx configuration", placeholder: "Pick nginx.conf to include everything it includes" }) : "";
  if (pick === undefined) return;
  const file = pick || (await inputBox({ title: "Explore an nginx configuration", placeholder: "Path to nginx.conf or a server block file" }))?.trim();
  if (file) openNginxFor(file);
}

/** "https://shop.example.com:8443/a/b?x=1" → a Request; bare paths use the given host. */
export function parseUrl(input: string, fallbackHost: string): Request | null {
  const s = input.trim();
  if (!s) return null;
  const m = /^(?:(https?):\/\/)?([^/?#]*)([^?#]*)(?:\?([^#]*))?/i.exec(s.startsWith("/") ? `http://${fallbackHost}${s}` : s);
  if (!m) return null;
  const scheme = (m[1]?.toLowerCase() ?? "http") as "http" | "https";
  const [host, port] = m[2].split(":");
  let uri = m[3] || "/";
  try {
    uri = decodeURI(uri);
  } catch {
    /* malformed %-escape: match the path as typed */
  }
  return { host: host || fallbackHost, port: port ? Number(port) : scheme === "https" ? 443 : 80, uri, args: m[4] ?? "", scheme };
}

export const NginxPane = forwardRef<EditorPaneHandle, { path: string }>(function NginxPane({ path }, ref) {
  const entry = path.startsWith(SCHEME) ? path.slice(SCHEME.length) : path;
  const [cfg, setCfg] = useState<{ tree: Directive[]; files: string[]; missing: { file: string; line: number; pattern: string }[] } | null>(null);
  const [error, setError] = useState<{ message: string; file?: string; line?: number } | null>(null);
  const [url, setUrl] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const loaded = await loadConfig(entry.replace(/\\/g, "/"), {
        read: async (p) => {
          const r = await native.readFile(p).catch(() => null);
          return r && r.kind === "text" ? r.content : null;
        },
        list: async (dir) => (await native.readDirAll(dir).catch(() => [])).filter((e) => e.kind !== "dir").map((e) => e.name),
      });
      if (!loaded.files.length) throw new Error(`Could not read ${entry}.`);
      setCfg(loaded);
    } catch (err) {
      setCfg(null);
      setError(err instanceof NginxSyntaxError ? { message: err.message, file: err.file, line: err.line } : { message: err instanceof Error ? err.message : String(err) });
    }
  }, [entry]);
  useEffect(() => void load(), [load]);
  useImperativeHandle(ref, () => toolPaneHandle(path, { reload: () => (void load(), true) }), [path, load]);

  const servers = useMemo(() => (cfg ? serversOf(cfg.tree) : []), [cfg]);
  const issues = useMemo(() => (cfg ? lintNginx(cfg.tree) : []), [cfg]);
  const firstHost = servers.flatMap((s) => s.names).find((n) => n && !/[*~]/.test(n) && n !== "_") ?? "localhost";
  useEffect(() => {
    if (cfg && !url) setUrl(`http://${firstHost}/`);
  }, [cfg, url, firstHost]);
  const outcome: Outcome | null = useMemo(() => {
    const req = cfg ? parseUrl(url, firstHost) : null;
    return req && cfg ? route(cfg.tree, req) : null;
  }, [cfg, url, firstHost]);

  const open = (d: { file: string; line: number }) => app().openFile(d.file, d.line, 1);
  const short = (f: string) => f.split(/[\\/]/).slice(-2).join("/");

  if (error)
    return (
      <div className="space-y-2 p-6 text-[12.5px]">
        <div className="text-red-500" data-nginx-error>
          {error.message}
        </div>
        {error.file && (
          <button type="button" className={btn} onClick={() => open({ file: error.file as string, line: error.line ?? 1 })}>
            Open at the error
          </button>
        )}
      </div>
    );
  if (!cfg) return <div className="p-6 text-[12.5px] text-muted-foreground">Reading the configuration…</div>;

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-2">
        <span className="font-mono text-[12px]">{short(entry)}</span>
        <span className="text-muted-foreground" data-nginx-summary>
          {cfg.files.length} file{cfg.files.length === 1 ? "" : "s"} · {servers.length} server{servers.length === 1 ? "" : "s"} · {issues.length} issue{issues.length === 1 ? "" : "s"}
        </span>
        {cfg.missing.length > 0 && <span className="text-red-600">Missing include: {cfg.missing.map((m) => m.pattern).join(", ")}</span>}
        <span className="flex-1" />
        <button type="button" className={btn} onClick={() => void load()}>
          Reload
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-80 shrink-0 overflow-auto border-r border-border/60 p-2" data-nginx-tree>
          {servers.map((s, i) => (
            <div key={i} className="mb-2">
              <button type="button" className="block w-full text-left hover:underline" onClick={() => open(s.directive)}>
                <span className={cn("font-medium", outcome?.server === s && "text-primary")}>server</span> <span className="text-muted-foreground">{s.listens.map((l) => `${l.address ? `${l.address}:` : ""}${l.port}${l.ssl ? " ssl" : ""}${l.defaultServer ? " default" : ""}`).join(", ")}</span>
              </button>
              <div className="truncate pl-3 font-mono text-[11.5px]">{s.names.join(" ") || "(no server_name)"}</div>
              <LocationTree locations={s.locations} active={outcome?.location ?? null} open={open} depth={1} />
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1 overflow-auto p-3">
          <div className="mb-3">
            <div className="mb-1 text-[11.5px] font-medium text-muted-foreground">Which server and location answer this request?</div>
            <input className="w-full max-w-2xl rounded border border-border/60 bg-transparent px-2 py-1 font-mono text-[12px]" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/api/users?page=2" data-nginx-url />
          </div>
          {outcome && <OutcomeView o={outcome} open={open} />}
          <div className="mt-5">
            <div className="mb-1 font-medium">Issues</div>
            {issues.length === 0 && <div className="text-emerald-600">No issues found.</div>}
            {issues.map((iss, i) => (
              <button key={i} type="button" className="flex w-full items-baseline gap-2 py-0.5 text-left hover:bg-muted/40" onClick={() => open(iss)} data-nginx-issue={iss.severity}>
                <span className={cn("shrink-0 rounded px-1 text-[10.5px]", SEV_STYLE[iss.severity])}>{iss.severity}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {short(iss.file)}:{iss.line}
                </span>
                <span>{iss.message}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

function LocationTree({ locations, active, open, depth }: { locations: Location[]; active: Location | null; open: (d: Directive) => void; depth: number }) {
  return (
    <>
      {locations.map((l, i) => (
        <div key={i}>
          <button type="button" className={cn("block w-full truncate text-left font-mono text-[11.5px] hover:underline", l === active && "rounded bg-primary/15 text-primary")} style={{ paddingLeft: depth * 12 }} onClick={() => open(l.directive)} data-nginx-location={`${l.modifier} ${l.path}`.trim()}>
            <span className="text-muted-foreground">location</span> {l.modifier && <span className="text-amber-700 dark:text-amber-400">{l.modifier} </span>}
            {l.path}
          </button>
          {l.locations.length > 0 && <LocationTree locations={l.locations} active={active} open={open} depth={depth + 1} />}
        </div>
      ))}
    </>
  );
}

function OutcomeView({ o, open }: { o: Outcome; open: (d: Directive) => void }) {
  const r = o.result;
  return (
    <div className="space-y-1.5 rounded border border-border/60 p-2" data-nginx-outcome>
      <div>
        <span className="text-muted-foreground">Server: </span>
        {o.server ? (
          <button type="button" className="hover:underline" onClick={() => open(o.server!.directive)}>
            {o.server.names[0] ?? "(unnamed)"} <span className="text-[11px] text-muted-foreground">line {o.server.directive.line}</span>
          </button>
        ) : (
          "none"
        )}
        <span className="text-muted-foreground"> — {o.serverWhy}</span>
      </div>
      {o.steps.map((s, i) => (
        <div key={i} className="font-mono text-[11.5px] text-sky-700 dark:text-sky-400">
          {s}
        </div>
      ))}
      {o.location && (
        <div>
          <span className="text-muted-foreground">Location: </span>
          <button type="button" className="font-mono hover:underline" onClick={() => open(o.location!.directive)}>
            {o.location.modifier} {o.location.path}
          </button>
          <span className="text-muted-foreground"> — {o.locationWhy}</span>
          {o.steps.length > 0 && <span className="text-muted-foreground"> (URI after rewrites: <span className="font-mono">{o.uri}</span>)</span>}
        </div>
      )}
      <div className="font-medium" data-nginx-result={r.kind}>
        {r.kind === "return" && (r.status >= 300 && r.status < 400 ? `Redirects (${r.status}) to ${r.body}` : `Responds ${r.status}${r.body ? ` with “${r.body}”` : ""}`)}
        {r.kind === "proxy" && (
          <>
            Proxies to <span className="font-mono">{r.target}</span>
            {r.upstream && <span className="font-normal text-muted-foreground"> (upstream: {r.upstream.join("; ")})</span>}
          </>
        )}
        {r.kind === "fastcgi" && <>Hands off to {r.target}</>}
        {r.kind === "file" && (
          <>
            Serves the first file that exists: <span className="font-mono">{r.paths.join(", ")}</span>
            {r.fallback && <span className="font-normal"> — otherwise {/^=\d+$/.test(r.fallback) ? `responds ${r.fallback.slice(1)}` : `internally redirects to ${r.fallback}`}</span>}
          </>
        )}
        {r.kind === "none" && <span className="text-muted-foreground">{r.detail}</span>}
      </div>
      {o.headers.length > 0 && (
        <div className="text-[11.5px] text-muted-foreground">
          Adds headers (from {o.headers[0].from}): {o.headers.map((h) => h.name).join(", ")}
        </div>
      )}
    </div>
  );
}

export const NGINX_ACTIONS = [
  { id: "nginx.open", label: "nginx: Explore a configuration and test which location handles a URL…", keywords: ["nginx", "config", "server block", "location", "proxy_pass", "rewrite", "reverse proxy", "web server"], run: () => void openNginxExplorer() },
];
