// The Remote sidebar view: SSH hosts, a lazy file tree per connected host
// (open files to edit them locally, saved back on save), terminals, search
// and port forwards.

import { useEffect } from "react";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { quickPick } from "@/modules/quick-pick";
import { joinRemote } from "./model";
import {
  addHost,
  connect,
  deleteEntry,
  dirKey,
  disconnect,
  forwardPort,
  loadDir,
  loadHosts,
  newEntry,
  openRemote,
  openTerminal,
  removeHost,
  renameEntry,
  search,
  setRoot,
  stopForward,
  toggleDir,
  useRemoteStore,
  type HostEntry,
} from "./store";

const btn = "rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground";

function fmtSize(n: number): string {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

function Dir({ alias, dir, depth }: { alias: string; dir: string; depth: number }) {
  const state = useRemoteStore((s) => s.dirs[dirKey(alias, dir)]);
  const expanded = useRemoteStore((s) => s.expanded);
  if (!state) return null;
  const pad = { paddingLeft: 10 + depth * 12 };
  if (state.error) return <div className="truncate py-0.5 text-[11px] text-destructive" style={pad} title={state.error}>{state.error}</div>;
  if (state.loading && !state.entries.length) return <div className="py-0.5 text-[11px] text-muted-foreground" style={pad}>Loading…</div>;
  if (!state.entries.length) return <div className="py-0.5 text-[11px] text-muted-foreground" style={pad}>Empty</div>;
  return (
    <>
      {state.entries.map((e) => {
        const path = joinRemote(dir, e.name);
        const open = Boolean(expanded[dirKey(alias, path)]);
        const menu = async () => {
          const pick = await quickPick(
            [
              ...(e.isDir
                ? [
                    { label: "New file…", value: () => newEntry(alias, path, "file") },
                    { label: "New folder…", value: () => newEntry(alias, path, "folder") },
                    { label: "Open terminal here", value: () => openTerminal(alias, path) },
                    { label: "Search in folder…", value: () => search(alias, path) },
                    { label: "Use as root", value: () => setRoot(alias, path) },
                  ]
                : [{ label: "Open", value: () => openRemote(alias, path) }]),
              { label: "Rename…", value: () => renameEntry(alias, path) },
              { label: "Copy path", value: () => navigator.clipboard.writeText(path) },
              { label: "Delete…", value: () => deleteEntry(alias, path, e.isDir) },
            ],
            { title: path },
          );
          void pick?.();
        };
        return (
          <div key={e.name}>
            <div
              className="group flex cursor-pointer items-center gap-1 py-[1px] pr-2 text-[12px] hover:bg-muted/50"
              style={pad}
              onClick={() => (e.isDir ? toggleDir(alias, path) : void openRemote(alias, path))}
              onContextMenu={(ev) => (ev.preventDefault(), void menu())}
              title={path}
            >
              <span className="w-3 shrink-0 text-[10px] text-muted-foreground">{e.isDir ? (open ? "▾" : "▸") : ""}</span>
              <span className={cn("min-w-0 flex-1 truncate", e.isDir && "font-medium", e.name.startsWith(".") && "text-muted-foreground", e.kind === "link" && "italic")}>{e.name}</span>
              {!e.isDir && <span className="shrink-0 text-[10.5px] text-muted-foreground/70 opacity-0 group-hover:opacity-100">{fmtSize(e.size)}</span>}
            </div>
            {e.isDir && open && <Dir alias={alias} dir={path} depth={depth + 1} />}
          </div>
        );
      })}
    </>
  );
}

function HostRow({ h }: { h: HostEntry }) {
  const conn = useRemoteStore((s) => s.conns[h.alias]);
  const status = conn?.status;
  const root = conn?.root;
  const rootOpen = useRemoteStore((s) => (root ? Boolean(s.expanded[dirKey(h.alias, root)]) : false));
  const menu = async () => {
    const pick = await quickPick(
      [
        ...(status === "connected"
          ? [
              { label: "Open terminal", value: () => openTerminal(h.alias) },
              { label: "Change folder…", value: () => setRoot(h.alias) },
              { label: "Search files…", value: () => search(h.alias, root ?? "/") },
              { label: "Forward a port…", value: () => forwardPort(h.alias) },
              { label: "Refresh", value: () => loadDir(h.alias, root ?? "/") },
              { label: "Disconnect", value: () => disconnect(h.alias) },
            ]
          : [{ label: "Connect", value: () => connect(h.alias) }]),
        ...(h.custom ? [{ label: "Remove host", value: () => removeHost(h.alias) }] : []),
      ],
      { title: h.alias },
    );
    void pick?.();
  };
  const detail = [h.user && `${h.user}@`, h.hostName ?? (h.custom ? "" : h.alias), h.port && `:${h.port}`].filter(Boolean).join("");
  return (
    <div className="border-b border-border/30">
      <div className="group flex items-center gap-1.5 px-2 py-1 text-[12px] hover:bg-muted/40" onContextMenu={(e) => (e.preventDefault(), void menu())}>
        <span
          className={cn("size-2 shrink-0 rounded-full", status === "connected" ? "bg-emerald-500" : status === "connecting" ? "animate-pulse bg-amber-500" : status === "error" ? "bg-destructive" : "bg-muted-foreground/30")}
          title={conn?.error ?? status ?? "not connected"}
        />
        <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => (status === "connected" ? setRoot(h.alias, root!) : void connect(h.alias))}>
          <span className="font-medium">{h.alias}</span>
          {detail && detail !== h.alias && <span className="ml-1.5 text-[11px] text-muted-foreground">{detail}</span>}
        </button>
        <span className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
          {status === "connected" ? (
            <button type="button" className={btn} title="Terminal" onClick={() => openTerminal(h.alias)}>
              ›_
            </button>
          ) : (
            <button type="button" className={btn} onClick={() => void connect(h.alias)}>
              Connect
            </button>
          )}
          <button type="button" className={btn} onClick={() => void menu()}>
            ⋯
          </button>
        </span>
      </div>
      {status === "connected" && root && (
        <div className="pb-1">
          <div className="flex items-center gap-1 px-2 text-[11px] text-muted-foreground">
            <button type="button" className="w-3" onClick={() => toggleDir(h.alias, root)}>
              {rootOpen ? "▾" : "▸"}
            </button>
            <button type="button" className="min-w-0 flex-1 truncate text-left hover:text-foreground" title="Change folder" onClick={() => void setRoot(h.alias)}>
              {root}
            </button>
            <span className="text-[10.5px]">{conn?.system}</span>
          </div>
          {rootOpen && <Dir alias={h.alias} dir={root} depth={1} />}
        </div>
      )}
      {status === "error" && conn?.error && <div className="line-clamp-3 px-6 pb-1 text-[11px] text-destructive">{conn.error}</div>}
    </div>
  );
}

export function RemotePanel() {
  const hosts = useRemoteStore((s) => s.hosts);
  const forwards = useRemoteStore((s) => s.forwards);
  useEffect(() => {
    void loadHosts();
  }, []);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/40 px-2">
        <span className="text-[11.5px] font-semibold">Remote (SSH)</span>
        <span className="flex-1" />
        <button type="button" className={btn} title="Reload ~/.ssh/config" onClick={() => void loadHosts()}>
          ⟳
        </button>
        <button type="button" className={btn} onClick={() => void addHost()}>
          + Host
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!hosts.length && <div className="p-3 text-[11.5px] text-muted-foreground">No hosts in ~/.ssh/config yet. Add one with “+ Host” (user@host:port). Key or agent authentication works everywhere; on macOS / Linux you can also sign in with a password once in a terminal.</div>}
        {hosts.map((h) => (
          <HostRow key={h.alias} h={h} />
        ))}
        {forwards.length > 0 && (
          <div className="mt-2 px-2">
            <div className="py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Forwarded ports</div>
            {forwards.map((f) => (
              <div key={f.key} className="group flex items-center gap-1.5 py-0.5 text-[12px]">
                <span className={cn("size-2 rounded-full", f.status === "up" ? "bg-emerald-500" : f.status === "starting" ? "bg-amber-500" : "bg-destructive")} title={f.error} />
                <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" disabled={f.status !== "up"} onClick={() => app().openPreview(`http://localhost:${f.local}`)}>
                  localhost:{f.local} → {f.host}:{f.remote}
                </button>
                <button type="button" className={cn(btn, "opacity-0 group-hover:opacity-100")} onClick={() => void stopForward(f.key)}>
                  Stop
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
