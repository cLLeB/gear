// The response panel under a .http editor: environment picker, status, timing
// waterfall, body (pretty JSON with a collapsible tree, HTML preview, images),
// headers, cookies, redirects, script tests and logs, history, copy as code.

import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { IS_WINDOWS } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import { quickPick } from "@/modules/quick-pick";
import { parseSetCookies, prettyBody, toCode } from "./model";
import { cancel, clearGlobals, loadEnvironments, sendAll, setEnv, useHttpStore, type HttpResponse } from "./store";

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(ms < 10 ? 1 : 0)} ms`;
}

function fmtSize(n: number): string {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;
}

function statusColor(s: number): string {
  return s >= 500 ? "bg-red-500/15 text-red-500" : s >= 400 ? "bg-amber-500/15 text-amber-600" : s >= 300 ? "bg-sky-500/15 text-sky-500" : "bg-emerald-500/15 text-emerald-600";
}

function JsonNode({ k, v, depth }: { k: string | null; v: unknown; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const isObj = v !== null && typeof v === "object";
  const keyEl = k !== null && <span className="text-sky-600 dark:text-sky-400">{k}: </span>;
  if (!isObj) {
    const cls = typeof v === "string" ? "text-emerald-600 dark:text-emerald-400" : typeof v === "number" ? "text-amber-600 dark:text-amber-400" : "text-purple-500";
    return (
      <div style={{ paddingLeft: depth * 14 }} className="whitespace-pre-wrap break-all">
        {keyEl}
        <span className={cls}>{JSON.stringify(v)}</span>
      </div>
    );
  }
  const entries = Array.isArray(v) ? v.map((x, i) => [String(i), x] as const) : Object.entries(v as Record<string, unknown>);
  const brackets = Array.isArray(v) ? ["[", "]"] : ["{", "}"];
  return (
    <div>
      <div style={{ paddingLeft: depth * 14 }} className="cursor-pointer select-none hover:bg-muted/40" onClick={() => setOpen((o) => !o)}>
        <span className="inline-block w-3 text-muted-foreground">{open ? "▾" : "▸"}</span>
        {keyEl}
        {brackets[0]}
        {!open && <span className="text-muted-foreground"> {entries.length} {Array.isArray(v) ? "items" : "keys"} {brackets[1]}</span>}
      </div>
      {open && entries.slice(0, 2000).map(([ck, cv]) => <JsonNode key={ck} k={Array.isArray(v) ? null : ck} v={cv} depth={depth + 1} />)}
      {open && <div style={{ paddingLeft: depth * 14 + 12 }}>{brackets[1]}</div>}
    </div>
  );
}

function Body({ r }: { r: HttpResponse }) {
  const [mode, setMode] = useState<"pretty" | "raw" | "tree" | "preview">(r.kind === "json" ? "tree" : r.kind === "html" ? "pretty" : "pretty");
  const parsed = useMemo(() => {
    if (r.kind !== "json" || !r.body) return undefined;
    try {
      return JSON.parse(r.body) as unknown;
    } catch {
      return undefined;
    }
  }, [r]);
  if (r.kind === "image") return <img src={convertFileSrc(r.bodyPath)} alt="" className="max-h-full max-w-full object-contain p-2" />;
  if (r.body === null) return <div className="p-3 text-[12px] text-muted-foreground">Binary body ({fmtSize(r.size)}). Use “Save body” to keep it.</div>;
  const modes = [...(parsed !== undefined ? (["tree"] as const) : []), "pretty" as const, "raw" as const, ...(r.kind === "html" ? (["preview"] as const) : [])];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-1 px-2 py-1">
        {modes.map((m) => (
          <button key={m} type="button" className={cn("rounded px-1.5 text-[11px]", mode === m ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted")} onClick={() => setMode(m)}>
            {m}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2 font-mono text-[12px] leading-[1.5]">
        {mode === "tree" && parsed !== undefined ? (
          <JsonNode k={null} v={parsed} depth={0} />
        ) : mode === "preview" ? (
          <iframe title="preview" sandbox="" srcDoc={r.body} className="h-full w-full rounded border border-border/60 bg-white" />
        ) : (
          <pre className="whitespace-pre-wrap break-all">{mode === "pretty" ? prettyBody(r.kind, r.body) : r.body}</pre>
        )}
      </div>
    </div>
  );
}

function Timing({ r }: { r: HttpResponse }) {
  if (!r.timing) return null;
  const total = r.timing.total || 1;
  let acc = 0;
  const colors = ["#a78bfa", "#60a5fa", "#f472b6", "#94a3b8", "#fbbf24", "#34d399"];
  return (
    <div className="flex flex-col gap-1.5 p-3 text-[12px]">
      {r.timing.phases.map((p, i) => {
        const left = (acc / total) * 100;
        acc += p.ms;
        return (
          <div key={p.label} className="grid grid-cols-[80px_1fr_70px] items-center gap-2">
            <span className="text-muted-foreground">{p.label}</span>
            <div className="relative h-3 rounded bg-muted/50">
              <div className="absolute top-0 h-3 rounded" style={{ left: `${left}%`, width: `${Math.max((p.ms / total) * 100, p.ms ? 0.5 : 0)}%`, background: colors[i] }} />
            </div>
            <span className="text-right tabular-nums">{fmtMs(p.ms)}</span>
          </div>
        );
      })}
      <div className="mt-1 grid grid-cols-[80px_1fr_70px] gap-2 font-medium">
        <span>Total</span>
        <span className="text-[11px] font-normal text-muted-foreground">
          {r.remoteIp} · HTTP/{r.httpVersion} · ↓ {fmtSize(r.size)}
        </span>
        <span className="text-right tabular-nums">{fmtMs(r.timing.total)}</span>
      </div>
    </div>
  );
}

function KV({ rows }: { rows: [string, string][] }) {
  return (
    <table className="w-full text-[12px]">
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={`${k}-${i}`} className="border-b border-border/30 align-top">
            <td className="whitespace-nowrap py-1 pl-3 pr-4 font-medium text-muted-foreground">{k}</td>
            <td className="break-all py-1 pr-3 font-mono">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ResponsePanel({ path, getText }: { path: string; getText: () => string }) {
  const history = useHttpStore((s) => s.history[path]);
  const selectedId = useHttpStore((s) => s.selected[path]);
  const running = useHttpStore((s) => Boolean(s.running[path]));
  const envs = useHttpStore((s) => s.envs[path]);
  const env = useHttpStore((s) => s.env[path] ?? null);
  const insecure = useHttpStore((s) => s.insecure);
  const [tab, setTab] = useState<"body" | "headers" | "cookies" | "timing" | "tests">("body");
  useEffect(() => {
    void loadEnvironments(path);
  }, [path]);
  const r = history?.find((h) => h.id === selectedId) ?? history?.[0];
  const cookies = r ? parseSetCookies(r.headers) : [];
  const tests = r?.script?.tests ?? [];
  const copyAs = async () => {
    if (!r) return;
    const lang = await quickPick(
      (["curl", "fetch", "python", "httpie"] as const).map((l) => ({ label: l, value: l })),
      { title: "Copy request as" },
    );
    if (!lang) return;
    await navigator.clipboard.writeText(toCode(r.request, lang));
    toast.success(`Copied as ${lang}`);
  };
  const saveBody = async () => {
    if (!r) return;
    const ext = r.kind === "json" ? "json" : r.kind === "html" ? "html" : r.kind === "xml" ? "xml" : r.kind === "image" ? (r.contentType.split("/")[1]?.split(";")[0] ?? "bin") : r.kind === "text" ? "txt" : "bin";
    const dest = `${path.replace(/\/[^/]*$/, "")}/response-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
    const res = await native.runCommand(IS_WINDOWS ? `Copy-Item -LiteralPath '${r.bodyPath.replace(/'/g, "''")}' -Destination '${dest.replace(/'/g, "''")}'` : `cp '${r.bodyPath.replace(/'/g, `'\\''`)}' '${dest.replace(/'/g, `'\\''`)}'`, null, 30);
    if (res.exit_code === 0) app().openFile(dest);
    else toast.error("Couldn't save the body", { description: res.stderr });
  };
  const tabs = [
    ["body", "Body"],
    ["headers", `Headers ${r?.headers.length ?? ""}`],
    ...(cookies.length ? [["cookies", `Cookies ${cookies.length}`]] : []),
    ["timing", "Timing"],
    ...(r?.script ? [["tests", `Tests ${tests.filter((t) => t.passed).length}/${tests.length}${r.script.error ? " ⚠" : ""}`]] : []),
  ] as [typeof tab, string][];
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-[12px]">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-2 py-1">
        <select className="rounded border border-border/60 bg-background px-1 py-0.5 text-[11.5px]" value={env ?? ""} onChange={(e) => setEnv(path, e.target.value || null)} title="Environment (http-client.env.json)">
          <option value="">No environment</option>
          {Object.keys(envs ?? {}).map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        {r && !r.error && <span className={cn("rounded px-1.5 py-0.5 font-medium tabular-nums", statusColor(r.status))}>{r.status} {r.statusText}</span>}
        {r?.error && <span className="truncate rounded bg-destructive/15 px-1.5 py-0.5 text-destructive">{r.error}</span>}
        {r?.timing && <span className="text-muted-foreground tabular-nums">{fmtMs(r.timing.total)}</span>}
        {r && !r.error && <span className="text-muted-foreground">{fmtSize(r.size)}</span>}
        {r && r.redirects.length > 0 && <span className="text-muted-foreground" title={r.redirects.map((b) => `${b.status} → ${b.headers.find(([k]) => k.toLowerCase() === "location")?.[1] ?? ""}`).join("\n")}>{r.redirects.length} redirect(s)</span>}
        <span className="flex-1" />
        {running ? (
          <button type="button" className="rounded px-2 py-0.5 text-destructive hover:bg-muted" onClick={() => void cancel(path)}>
            Cancel
          </button>
        ) : (
          <button type="button" className="rounded px-2 py-0.5 hover:bg-muted" onClick={() => void sendAll(path, getText())} title="Send every request in order and report">
            Run all
          </button>
        )}
        {history && history.length > 1 && (
          <select className="max-w-48 rounded border border-border/60 bg-background px-1 py-0.5 text-[11.5px]" value={r?.id} onChange={(e) => useHttpStore.setState((s) => ({ selected: { ...s.selected, [path]: e.target.value } }))} title="History">
            {history.map((h) => (
              <option key={h.id} value={h.id}>
                {new Date(h.at).toLocaleTimeString([], { hour12: false })} {h.error ? "✗" : h.status} {h.key}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="rounded px-2 py-0.5 hover:bg-muted"
          onClick={async () => {
            const pick = await quickPick(
              [
                { label: "Copy request as code…", value: "copy" },
                { label: "Copy response body", value: "body" },
                { label: "Save response body to a file", value: "save" },
                { label: insecure ? "Verify TLS certificates" : "Skip TLS verification (self-signed)", value: "tls" },
                { label: "Clear client.global variables", value: "globals" },
                { label: "Create http-client.env.json", value: "env" },
              ],
              { title: "HTTP client" },
            );
            if (pick === "copy") void copyAs();
            else if (pick === "body" && r?.body) void navigator.clipboard.writeText(r.body);
            else if (pick === "save") void saveBody();
            else if (pick === "tls") useHttpStore.setState({ insecure: !insecure });
            else if (pick === "globals") clearGlobals();
            else if (pick === "env") {
              const p = `${path.replace(/\/[^/]*$/, "")}/http-client.env.json`;
              const exists = (await native.readFile(p).catch(() => null))?.kind === "text";
              if (!exists) await native.writeFile(p, `${JSON.stringify({ dev: { host: "http://localhost:3000" }, prod: { host: "https://api.example.com" } }, null, 2)}\n`, "user");
              app().openFile(p);
              void loadEnvironments(path);
            }
          }}
        >
          ⋯
        </button>
      </div>
      {!r ? (
        <div className="p-4 text-muted-foreground">{running ? "Sending…" : "Send a request with ▶ in the gutter or Ctrl/⌘+Enter. Variables: @name = value, {{$uuid}}, {{$timestamp}}, environments in http-client.env.json, chain with {{login.response.body.$.token}}."}</div>
      ) : (
        <>
          <div className="flex shrink-0 gap-1 border-b border-border/40 px-2 pt-1">
            {tabs.map(([id, label]) => (
              <button key={id} type="button" className={cn("rounded-t px-2 py-0.5 text-[11.5px]", tab === id ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground")} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
            <span className="flex-1" />
            <span className="truncate self-center text-[11px] text-muted-foreground" title={r.label}>
              {r.label}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {r.error ? (
              <div className="p-3 text-destructive">{r.error}</div>
            ) : tab === "body" ? (
              <Body key={r.id} r={r} />
            ) : tab === "headers" ? (
              <KV rows={r.headers} />
            ) : tab === "cookies" ? (
              <KV rows={cookies.map((c) => [c.name, `${c.value}${Object.entries(c.attrs).map(([k, v]) => `; ${k}${v === true ? "" : `=${v}`}`).join("")}`])} />
            ) : tab === "timing" ? (
              <Timing r={r} />
            ) : (
              <div className="flex flex-col gap-1 p-3">
                {tests.map((t, i) => (
                  <div key={i} className={t.passed ? "text-emerald-600" : "text-red-500"}>
                    {t.passed ? "✓" : "✗"} {t.name}
                    {t.error && <span className="ml-2 text-muted-foreground">{t.error}</span>}
                  </div>
                ))}
                {r.script?.error && <div className="text-red-500">Script error: {r.script.error}</div>}
                {r.script?.logs.map((l, i) => (
                  <div key={`l${i}`} className="font-mono text-muted-foreground">
                    {l}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

