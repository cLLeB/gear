// Editor tabs for gear-docker:// paths: the dev container build log, a
// container's live logs (follow, filter, levels, timestamps) and a container's
// inspect view (summary plus the raw JSON).

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { app } from "@/app/appBridge";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { ansiSpans, commandLine, parseLogLines, parsePorts, type LogLine } from "./model";
import { docker, openShell, parseDockerPath, useContainersStore } from "./store";
import { IS_WINDOWS } from "@/lib/platform";

const ANSI_COLORS = ["#4b5563", "#ef4444", "#22c55e", "#eab308", "#3b82f6", "#a855f7", "#06b6d4", "#d1d5db", "#6b7280", "#f87171", "#4ade80", "#facc15", "#60a5fa", "#c084fc", "#22d3ee", "#f9fafb"];

function Ansi({ text }: { text: string }) {
  return (
    <>
      {ansiSpans(text).map((s, i) => (
        <span key={i} style={{ color: s.fg === null ? undefined : ANSI_COLORS[s.fg], fontWeight: s.bold ? 600 : undefined }}>
          {s.text}
        </span>
      ))}
    </>
  );
}

function handle(path: string, setQuery: (q: string) => void, reload: () => void): EditorPaneHandle {
  return {
    setQuery,
    findNext: () => {},
    findPrevious: () => {},
    clearQuery: () => setQuery(""),
    focus: () => {},
    getSelection: () => null,
    getPath: () => path,
    reload: () => {
      reload();
      return true;
    },
    gotoLine: () => {},
    undo: () => {},
    redo: () => {},
    openFindReplace: () => {},
    toggleBlame: () => {},
    save: async () => {},
  } as EditorPaneHandle;
}

function useAutoScroll(dep: unknown, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (enabled && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [dep, enabled]);
  return ref;
}

const DevLog = forwardRef<EditorPaneHandle, { path: string }>(function DevLog({ path }, handleRef) {
  useImperativeHandle(handleRef, () => handle(path, () => {}, () => {}), [path]);
  const log = useContainersStore((s) => s.log);
  const running = useContainersStore((s) => s.logRunning);
  const dev = useContainersStore((s) => s.dev);
  const ref = useAutoScroll(log, true);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5 text-[12px]">
        <span className="font-medium">{dev.resolved?.name ?? "Dev container"}</span>
        <span className={cn("rounded px-1.5 text-[11px]", dev.phase === "running" ? "bg-emerald-500/15 text-emerald-500" : dev.phase === "error" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground")}>{running ? "working…" : dev.phase}</span>
        <span className="flex-1" />
        {dev.containerId && dev.phase === "running" && (
          <button type="button" className="rounded px-2 py-0.5 hover:bg-muted" onClick={() => openShell({ id: dev.containerId! }, { user: dev.resolved?.remoteUser, cwd: dev.resolved?.workspaceFolder, env: dev.env })}>
            Open terminal
          </button>
        )}
      </div>
      <div ref={ref} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-[12px] leading-[1.45]">
        {log ? <Ansi text={log.replace(/\r(?!\n)/g, "\n")} /> : <span className="text-muted-foreground">Nothing yet.</span>}
      </div>
    </div>
  );
});

const MAX_LINES = 20_000;
const LEVEL_CLASS: Record<string, string> = { error: "text-red-500", warn: "text-amber-500", debug: "text-muted-foreground" };

/** Live logs: `docker logs -f` by default, or any streaming command (`argv`), e.g. kubectl logs -f. */
export const ContainerLogs = forwardRef<EditorPaneHandle, { path: string; id: string; name: string; argv?: string[]; onShell?: () => void }>(function ContainerLogs({ path, id, name, argv, onShell }, ref) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [filter, setFilter] = useState("");
  const [levels, setLevels] = useState<Record<string, boolean>>({ error: true, warn: true, info: true, debug: true, other: true });
  const [stamps, setStamps] = useState(false);
  const [follow, setFollow] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [ended, setEnded] = useState<string | null>(null);
  const [gen, setGen] = useState(0);
  useImperativeHandle(ref, () => handle(path, setFilter, () => setGen((g) => g + 1)), [path]);

  useEffect(() => {
    let alive = true;
    let bg: number | null = null;
    let partial = "";
    setLines([]);
    setEnded(null);
    void (async () => {
      bg = await native.shellBgSpawn(commandLine(argv ?? ["docker", "logs", "--follow", "--timestamps", "--tail", "2000", id], IS_WINDOWS), null);
      let offset = 0;
      while (alive) {
        const r = await native.shellBgLogs(bg, offset).catch(() => null);
        if (!r) break;
        offset = r.next_offset;
        if (r.bytes) {
          const text = partial + r.bytes;
          const cut = text.lastIndexOf("\n") + 1;
          partial = text.slice(cut);
          const fresh = parseLogLines(text.slice(0, cut));
          if (fresh.length) setLines((old) => (old.length + fresh.length > MAX_LINES ? [...old, ...fresh].slice(-MAX_LINES) : [...old, ...fresh]));
        }
        if (r.exited) {
          setEnded(r.exit_code === 0 ? "Log stream ended" : `${(argv ?? ["docker"])[0]} logs exited with ${r.exit_code}`);
          break;
        }
        await new Promise((res) => setTimeout(res, 300));
      }
    })();
    return () => {
      alive = false;
      if (bg !== null) void native.shellBgKill(bg);
    };
  }, [id, gen, argv?.join("\u0000")]);

  const re = useMemo(() => {
    if (!filter) return null;
    try {
      return new RegExp(filter, "i");
    } catch {
      return new RegExp(filter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    }
  }, [filter]);
  const shown = useMemo(() => lines.filter((l) => levels[l.level ?? "other"] && (!re || re.test(l.text))), [lines, levels, re]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of lines) c[l.level ?? "other"] = (c[l.level ?? "other"] ?? 0) + 1;
    return c;
  }, [lines]);

  // Window the rows when lines don't wrap (fixed height); wrapped mode shows the tail.
  const ROW = 18;
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  useEffect(() => {
    const el = scroller.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [shown, follow]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setView({ top: el.scrollTop, height: el.clientHeight });
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    if (atBottom !== follow) setFollow(atBottom);
  };
  const first = wrap ? Math.max(0, shown.length - 3000) : Math.max(0, Math.floor(view.top / ROW) - 20);
  const last = wrap ? shown.length : Math.min(shown.length, first + Math.ceil(view.height / ROW) + 40);
  const btn = (on: boolean) => cn("rounded px-1.5 py-0.5 text-[11px]", on ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted");

  const fmt = (t: string | null) => (t ? new Date(t).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions) : "");
  const row = (l: LogLine, i: number) => (
    <div key={first + i} className={cn("px-3", wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre", l.level && LEVEL_CLASS[l.level])} style={wrap ? undefined : { height: ROW }}>
      {stamps && <span className="mr-2 select-none text-muted-foreground/70">{fmt(l.time)}</span>}
      {re ? highlight(l.text, re) : l.text}
    </div>
  );
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-3 py-1.5 text-[12px]">
        <span className="mr-1 font-medium">{name}</span>
        <input className="w-48 rounded border border-border/60 bg-background px-2 py-0.5 text-[12px]" placeholder="Filter (regex)" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {(["error", "warn", "info", "debug", "other"] as const).map((lv) => (
          <button key={lv} type="button" className={btn(levels[lv])} onClick={() => setLevels((x) => ({ ...x, [lv]: !x[lv] }))}>
            {lv} {counts[lv] ?? 0}
          </button>
        ))}
        <span className="flex-1" />
        <button type="button" className={btn(stamps)} onClick={() => setStamps((x) => !x)}>
          Time
        </button>
        <button type="button" className={btn(wrap)} onClick={() => setWrap((x) => !x)}>
          Wrap
        </button>
        <button type="button" className={btn(follow)} onClick={() => setFollow((x) => !x)}>
          Follow
        </button>
        <button type="button" className={btn(false)} onClick={() => setLines([])}>
          Clear
        </button>
        <button type="button" className={btn(false)} onClick={() => (onShell ? onShell() : openShell({ id }))}>
          Shell
        </button>
      </div>
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto py-1 font-mono text-[12px] leading-[18px]">
        {wrap ? (
          shown.slice(first, last).map(row)
        ) : (
          <div style={{ height: shown.length * ROW, position: "relative" }}>
            <div style={{ position: "absolute", top: first * ROW, left: 0, right: 0 }}>{shown.slice(first, last).map(row)}</div>
          </div>
        )}
        {!shown.length && <div className="px-3 text-muted-foreground">{lines.length ? "No lines match." : "Waiting for output…"}</div>}
      </div>
      {ended && <div className="border-t border-border/60 px-3 py-1 text-[11px] text-muted-foreground">{ended}</div>}
    </div>
  );
});

function highlight(text: string, re: RegExp) {
  const m = re.exec(text);
  if (!m || !m[0]) return text;
  return (
    <>
      {text.slice(0, m.index)}
      <mark className="rounded-sm bg-amber-400/40 text-inherit">{m[0]}</mark>
      {text.slice(m.index + m[0].length)}
    </>
  );
}

interface Inspect {
  Id: string;
  Name: string;
  Created: string;
  State: { Status: string; StartedAt: string; ExitCode: number; Health?: { Status: string } };
  Config: { Image: string; Env: string[] | null; Cmd: string[] | null; Entrypoint: string[] | null; WorkingDir: string; User: string; Labels: Record<string, string> | null };
  Mounts: { Type: string; Source: string; Destination: string; RW: boolean }[];
  NetworkSettings: { Ports: Record<string, { HostIp: string; HostPort: string }[] | null> | null; Networks: Record<string, { IPAddress: string }> | null };
  HostConfig: { RestartPolicy?: { Name: string }; Memory?: number; NanoCpus?: number };
}

const InspectView = forwardRef<EditorPaneHandle, { path: string; id: string; name: string }>(function InspectView({ path, id, name }, ref) {
  const [data, setData] = useState<Inspect | null>(null);
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [gen, setGen] = useState(0);
  useImperativeHandle(ref, () => handle(path, () => {}, () => setGen((g) => g + 1)), [path]);
  useEffect(() => {
    docker(["docker", "inspect", id])
      .then((out) => {
        const parsed = (JSON.parse(out) as Inspect[])[0];
        setData(parsed);
        setRaw(JSON.stringify(parsed, null, 2));
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [id, gen]);
  if (error) return <div className="p-6 text-[12px] text-destructive">{error}</div>;
  if (!data) return <div className="p-6 text-[12px] text-muted-foreground">Loading…</div>;
  const ports = Object.entries(data.NetworkSettings.Ports ?? {}).flatMap(([k, v]) => (v ?? []).map((b) => `${b.HostIp}:${b.HostPort}->${k}`));
  const kv = (k: string, v: React.ReactNode) => (
    <>
      <div className="text-muted-foreground">{k}</div>
      <div className="min-w-0 break-all">{v}</div>
    </>
  );
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5 text-[12px]">
        <span className="font-medium">{name}</span>
        <span className="text-muted-foreground">{data.Id.slice(0, 12)}</span>
        <span className="flex-1" />
        <button type="button" className={cn("rounded px-2 py-0.5", showRaw ? "bg-primary/15 text-primary" : "hover:bg-muted")} onClick={() => setShowRaw((x) => !x)}>
          Raw JSON
        </button>
      </div>
      {showRaw ? (
        <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[12px]">{raw}</pre>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-4 text-[12px]">
          <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-1.5">
            {kv("State", `${data.State.Status}${data.State.Health ? ` (${data.State.Health.Status})` : ""}${data.State.Status === "exited" ? `, exit ${data.State.ExitCode}` : ""}`)}
            {kv("Image", data.Config.Image)}
            {kv("Started", data.State.StartedAt ? new Date(data.State.StartedAt).toLocaleString() : "—")}
            {kv("Command", [...(data.Config.Entrypoint ?? []), ...(data.Config.Cmd ?? [])].join(" ") || "—")}
            {kv("User / workdir", `${data.Config.User || "root"} · ${data.Config.WorkingDir || "/"}`)}
            {kv("Restart", data.HostConfig.RestartPolicy?.Name || "no")}
            {kv(
              "Ports",
              ports.length
                ? parsePorts(ports.join(", ")).map((p) => (
                    <button key={`${p.hostPort}-${p.containerPort}`} type="button" className="mr-2 text-primary hover:underline" disabled={!p.hostPort} onClick={() => app().openPreview(`http://localhost:${p.hostPort}`)}>
                      {p.containerPort}/{p.proto} → {p.hostPort ?? "—"}
                    </button>
                  ))
                : "—",
            )}
            {kv("Networks", Object.entries(data.NetworkSettings.Networks ?? {}).map(([n, v]) => `${n} ${v.IPAddress}`).join(", ") || "—")}
          </div>
          <h3 className="mb-1 mt-5 font-medium">Mounts</h3>
          {data.Mounts.length ? (
            <table className="w-full">
              <tbody>
                {data.Mounts.map((m) => (
                  <tr key={m.Destination} className="border-t border-border/40">
                    <td className="py-1 pr-3 text-muted-foreground">{m.Type}</td>
                    <td className="break-all py-1 pr-3">{m.Source}</td>
                    <td className="break-all py-1 pr-3">{m.Destination}</td>
                    <td className="py-1 text-muted-foreground">{m.RW ? "rw" : "ro"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-muted-foreground">None</div>
          )}
          <h3 className="mb-1 mt-5 font-medium">Environment</h3>
          <div className="font-mono">
            {(data.Config.Env ?? []).map((e) => (
              <div key={e} className="break-all">
                <span className="text-primary">{e.slice(0, e.indexOf("="))}</span>={e.slice(e.indexOf("=") + 1)}
              </div>
            ))}
          </div>
          <h3 className="mb-1 mt-5 font-medium">Labels</h3>
          <div className="font-mono">
            {Object.entries(data.Config.Labels ?? {}).map(([k, v]) => (
              <div key={k} className="break-all">
                <span className="text-muted-foreground">{k}</span>={v}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

export const DockerPane = forwardRef<EditorPaneHandle, { path: string }>(function DockerPane({ path }, ref) {
  const p = parseDockerPath(path);
  if (!p) return <div className="p-6 text-[12px] text-muted-foreground">Unknown view.</div>;
  if (p.kind === "log") return <DevLog ref={ref} path={path} />;
  if (p.kind === "logs") return <ContainerLogs ref={ref} path={path} id={p.id} name={p.name} />;
  return <InspectView ref={ref} path={path} id={p.id} name={p.name} />;
});
