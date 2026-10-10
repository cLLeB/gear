// Remote development state: SSH hosts (from ~/.ssh/config plus ones added
// here), connections, remote directory listings, files mirrored locally for
// editing (saved back over sftp with a conflict check), terminals, search and
// port forwards. Everything goes through the system ssh / sftp.

import { appCacheDir, homeDir } from "@tauri-apps/api/path";
import { toast } from "sonner";
import { create } from "zustand";
import { app } from "@/app/appBridge";
import { IS_WINDOWS } from "@/lib/platform";
import { native } from "@/modules/ai/lib/native";
import { commandLine } from "@/modules/containers/model";
import { confirmPick, inputBox, quickPick } from "@/modules/quick-pick";
import {
  cksumScript,
  encodeScript,
  forwardArgv,
  grepScript,
  joinRemote,
  listScript,
  mirrorPath,
  opScript,
  parentRemote,
  parseCksum,
  parseDestination,
  parseGrep,
  parseList,
  parseListening,
  parseProbe,
  parseSshConfig,
  PORTS_SCRIPT,
  PROBE,
  sftpArgv,
  sftpBatch,
  shellScript,
  sshArgv,
  type FileOp,
  type RemoteEntry,
  type SshHost,
  type SshOptions,
} from "./model";

export interface HostEntry extends SshHost {
  /** Added in Gear (not from ~/.ssh/config). */
  custom?: boolean;
}

export interface Connection {
  status: "connecting" | "connected" | "error";
  system?: string;
  home?: string;
  error?: string;
  root: string | null;
}

export interface DirState {
  entries: RemoteEntry[];
  loading: boolean;
  error?: string;
}

export interface Forward {
  key: string;
  host: string;
  local: number;
  remote: number;
  handle: number;
  status: "starting" | "up" | "failed";
  error?: string;
}

interface Mirror {
  host: string;
  remotePath: string;
  cksum: string;
}

interface RemoteStore {
  hosts: HostEntry[];
  conns: Record<string, Connection>;
  dirs: Record<string, DirState>;
  expanded: Record<string, boolean>;
  forwards: Forward[];
  mirrors: Record<string, Mirror>;
}

const CUSTOM_KEY = "gear-remote-hosts";
const ROOTS_KEY = "gear-remote-roots";
const MIRRORS_KEY = "gear-remote-mirrors";

function load<T>(k: string, d: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
}

function save(k: string, v: unknown): void {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export const useRemoteStore = create<RemoteStore>(() => ({ hosts: [], conns: {}, dirs: {}, expanded: {}, forwards: [], mirrors: load(MIRRORS_KEY, {}) }));

export const dirKey = (host: string, dir: string) => `${host}\u0000${dir}`;

function host(alias: string): HostEntry | undefined {
  return useRemoteStore.getState().hosts.find((h) => h.alias === alias);
}

function opts(alias: string, batch = true): SshOptions {
  const h = host(alias);
  // Custom hosts carry their own port; config hosts get it from ~/.ssh/config.
  return { multiplex: !IS_WINDOWS, batch, port: h?.custom ? h.port : undefined };
}

const line = (argv: string[]) => commandLine(argv, IS_WINDOWS);

/** Run a script on the host; throws with stderr. */
export async function run(alias: string, script: string, timeoutSecs = 30): Promise<string> {
  const r = await native.runCommand(line(sshArgv(alias, IS_WINDOWS ? encodeScript(script) : script, opts(alias))), null, timeoutSecs);
  if (r.timed_out) throw new Error(`Timed out talking to ${alias}`);
  if (r.exit_code !== 0) throw new Error((r.stderr || r.stdout || `ssh exited with ${r.exit_code}`).trim().split("\n").slice(-3).join("\n"));
  return r.stdout;
}

// ── hosts ─────────────────────────────────────────────────────────────────

export async function loadHosts(): Promise<void> {
  const home = (await homeDir()).replace(/\\/g, "/").replace(/\/+$/, "");
  const r = await native.readFile(`${home}/.ssh/config`).catch(() => null);
  const fromConfig = r?.kind === "text" ? parseSshConfig(r.content) : [];
  const custom = load<HostEntry[]>(CUSTOM_KEY, []).map((h) => ({ ...h, custom: true }));
  useRemoteStore.setState({ hosts: [...fromConfig, ...custom.filter((c) => !fromConfig.some((f) => f.alias === c.alias))] });
}

export async function addHost(): Promise<void> {
  const v = await inputBox({ title: "Add SSH host", placeholder: "user@host.example.com:22" });
  if (!v?.trim()) return;
  const d = parseDestination(v);
  if (!d) return void toast.error("Use user@host or user@host:port");
  const custom = load<HostEntry[]>(CUSTOM_KEY, []).filter((h) => h.alias !== d.dest);
  save(CUSTOM_KEY, [...custom, { alias: d.dest, port: d.port }]);
  await loadHosts();
  await connect(d.dest);
}

export async function removeHost(alias: string): Promise<void> {
  save(CUSTOM_KEY, load<HostEntry[]>(CUSTOM_KEY, []).filter((h) => h.alias !== alias));
  disconnect(alias);
  await loadHosts();
}

// ── connections ───────────────────────────────────────────────────────────

function setConn(alias: string, patch: Partial<Connection>): void {
  useRemoteStore.setState((s) => ({ conns: { ...s.conns, [alias]: { ...(s.conns[alias] ?? { status: "connecting", root: null }), ...patch } } }));
}

export async function connect(alias: string): Promise<boolean> {
  setConn(alias, { status: "connecting", error: undefined });
  try {
    const p = parseProbe(await run(alias, PROBE, 25));
    const root = load<Record<string, string>>(ROOTS_KEY, {})[alias] ?? p.home;
    setConn(alias, { status: "connected", system: p.system, home: p.home, root });
    useRemoteStore.setState((s) => ({ expanded: { ...s.expanded, [dirKey(alias, root)]: true } }));
    await loadDir(alias, root);
    return true;
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    setConn(alias, { status: "error", error: msg });
    const auth = /permission denied|password|passphrase|host key verification/i.test(msg);
    toast.error(`Couldn't connect to ${alias}`, {
      description: msg,
      action: auth && !IS_WINDOWS ? { label: "Sign in in a terminal", onClick: () => authenticate(alias) } : undefined,
    });
    return false;
  }
}

/** Interactive login (password, passphrase, new host key); later commands reuse the connection. */
export function authenticate(alias: string): void {
  app().openTerminal({ command: line(sshArgv(alias, "echo; echo Signed in to $(hostname). Gear can use this connection now; keep this tab open or close it.; exec ${SHELL:-/bin/sh} -l", opts(alias, false), true)) });
  toast.info("After signing in, click Connect again", { description: "The connection is shared for 10 minutes after the terminal closes." });
}

export function disconnect(alias: string): void {
  useRemoteStore.setState((s) => {
    const { [alias]: _, ...conns } = s.conns;
    const dirs = Object.fromEntries(Object.entries(s.dirs).filter(([k]) => !k.startsWith(`${alias}\u0000`)));
    return { conns, dirs };
  });
  if (!IS_WINDOWS) void native.runCommand(line(["ssh", ...["-o", "ControlPath=~/.ssh/cm-gear-%C"], "-O", "exit", alias]), null, 10).catch(() => {});
  for (const f of useRemoteStore.getState().forwards.filter((x) => x.host === alias)) void stopForward(f.key);
}

export async function setRoot(alias: string, dir?: string): Promise<void> {
  const c = useRemoteStore.getState().conns[alias];
  const next = dir ?? (await inputBox({ title: `Folder on ${alias}`, value: c?.root ?? c?.home ?? "/" }))?.trim();
  if (!next) return;
  save(ROOTS_KEY, { ...load<Record<string, string>>(ROOTS_KEY, {}), [alias]: next });
  setConn(alias, { root: next });
  useRemoteStore.setState((s) => ({ expanded: { ...s.expanded, [dirKey(alias, next)]: true } }));
  await loadDir(alias, next);
}

// ── listing and file operations ───────────────────────────────────────────

export async function loadDir(alias: string, dir: string): Promise<void> {
  const k = dirKey(alias, dir);
  useRemoteStore.setState((s) => ({ dirs: { ...s.dirs, [k]: { entries: s.dirs[k]?.entries ?? [], loading: true } } }));
  try {
    const entries = parseList(await run(alias, listScript(dir)));
    useRemoteStore.setState((s) => ({ dirs: { ...s.dirs, [k]: { entries, loading: false } } }));
  } catch (e) {
    useRemoteStore.setState((s) => ({ dirs: { ...s.dirs, [k]: { entries: [], loading: false, error: String((e as Error).message ?? e) } } }));
  }
}

export function toggleDir(alias: string, dir: string): void {
  const k = dirKey(alias, dir);
  const open = !useRemoteStore.getState().expanded[k];
  useRemoteStore.setState((s) => ({ expanded: { ...s.expanded, [k]: open } }));
  if (open && !useRemoteStore.getState().dirs[k]) void loadDir(alias, dir);
}

export async function fileOp(alias: string, o: FileOp): Promise<void> {
  try {
    await run(alias, opScript(o));
  } catch (e) {
    return void toast.error("Failed", { description: String((e as Error).message ?? e) });
  }
  const dirs = new Set<string>();
  if (o.op === "rename") [o.from, o.to].forEach((p) => dirs.add(parentRemote(p)));
  else dirs.add(parentRemote(o.path));
  for (const d of dirs) await loadDir(alias, d);
}

export async function newEntry(alias: string, dir: string, kind: "file" | "folder"): Promise<void> {
  const name = (await inputBox({ title: `New ${kind} in ${dir}`, placeholder: kind === "file" ? "notes.md" : "src" }))?.trim();
  if (!name || name.includes("/")) return;
  const path = joinRemote(dir, name);
  await fileOp(alias, kind === "file" ? { op: "touch", path } : { op: "mkdir", path });
  if (kind === "file") await openRemote(alias, path);
}

export async function renameEntry(alias: string, path: string): Promise<void> {
  const name = (await inputBox({ title: "Rename", value: path.split("/").pop() }))?.trim();
  if (!name || name.includes("/")) return;
  await fileOp(alias, { op: "rename", from: path, to: joinRemote(parentRemote(path), name) });
}

export async function deleteEntry(alias: string, path: string, isDir: boolean): Promise<void> {
  if (!(await confirmPick(`Delete ${path} on ${alias}?`, "Delete", isDir ? "The folder and everything in it" : "This can't be undone"))) return;
  await fileOp(alias, { op: "delete", path });
}

// ── editing through local mirrors ─────────────────────────────────────────

async function cacheRoot(): Promise<string> {
  return `${(await appCacheDir()).replace(/\\/g, "/").replace(/\/+$/, "")}/remote`;
}

async function sftp(alias: string, lines: Parameters<typeof sftpBatch>[0]): Promise<void> {
  const root = await cacheRoot();
  await native.createDir(root).catch(() => {});
  const batch = `${root}/.batch-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await native.writeFile(batch, sftpBatch(lines), "user");
  try {
    const r = await native.runCommand(line(sftpArgv(alias, batch, opts(alias))), null, 300);
    if (r.exit_code !== 0) throw new Error((r.stderr || r.stdout || "sftp failed").trim());
  } finally {
    void native.runCommand(IS_WINDOWS ? `Remove-Item -Force ${commandLine([batch], true)}` : `rm -f ${commandLine([batch], false)}`, null, 10).catch(() => {});
  }
}

function setMirror(local: string, m: Mirror | null): void {
  useRemoteStore.setState((s) => {
    const { [local]: _, ...rest } = s.mirrors;
    const mirrors = m ? { ...rest, [local]: m } : rest;
    save(MIRRORS_KEY, mirrors);
    return { mirrors };
  });
}

export async function openRemote(alias: string, remotePath: string, line?: number): Promise<void> {
  const local = mirrorPath(await cacheRoot(), alias, remotePath);
  const t = toast.loading(`Opening ${remotePath.split("/").pop()} from ${alias}…`);
  try {
    await native.createDir(local.slice(0, local.lastIndexOf("/"))).catch(() => {});
    const cksum = parseCksum(await run(alias, cksumScript(remotePath)));
    if (cksum === "missing") throw new Error(`${remotePath} doesn't exist`);
    await sftp(alias, [["get", remotePath, local]]);
    setMirror(local, { host: alias, remotePath, cksum });
    app().openFile(local, line);
  } catch (e) {
    toast.error("Couldn't open the remote file", { description: String((e as Error).message ?? e) });
  } finally {
    toast.dismiss(t);
  }
}

/** Upload a saved mirror; asks before overwriting a file that changed on the host. */
export async function uploadMirror(local: string): Promise<void> {
  const m = useRemoteStore.getState().mirrors[local];
  if (!m) return;
  try {
    const now = parseCksum(await run(m.host, cksumScript(m.remotePath)));
    if (now !== m.cksum && now !== "missing") {
      const pick = await quickPick(
        [
          { label: "Overwrite the remote file", detail: "Replace the newer remote copy with yours", value: "overwrite" },
          { label: "Open the remote version", detail: "Download it next to yours (…remote) to compare and merge", value: "compare" },
          { label: "Don't upload", value: "skip" },
        ],
        { title: `${m.remotePath.split("/").pop()} changed on ${m.host} since you opened it` },
      );
      if (pick === "compare") {
        const other = `${local}.remote`;
        await sftp(m.host, [["get", m.remotePath, other]]);
        app().openFile(other);
        return;
      }
      if (pick !== "overwrite") return;
    }
    await sftp(m.host, [["put", local, m.remotePath]]);
    setMirror(local, { ...m, cksum: parseCksum(await run(m.host, cksumScript(m.remotePath))) });
    toast.success(`Saved to ${m.host}:${m.remotePath}`);
  } catch (e) {
    toast.error(`Couldn't save to ${m.host}`, { description: String((e as Error).message ?? e), action: { label: "Retry", onClick: () => void uploadMirror(local) } });
  }
}

export function installSaveHook(): () => void {
  const onSave = (e: Event) => {
    const path = (e as CustomEvent<{ path: string }>).detail.path.replace(/\\/g, "/");
    if (useRemoteStore.getState().mirrors[path]) void uploadMirror(path);
  };
  window.addEventListener("gear:file-saved", onSave);
  return () => window.removeEventListener("gear:file-saved", onSave);
}

// ── terminals, search, ports ──────────────────────────────────────────────

export function openTerminal(alias: string, dir?: string | null): void {
  app().openTerminal({ command: line(sshArgv(alias, shellScript(dir ?? useRemoteStore.getState().conns[alias]?.root ?? null), opts(alias, false), true)) });
}

export async function search(alias: string, dir: string): Promise<void> {
  const pattern = (await inputBox({ title: `Search in ${alias}:${dir}`, placeholder: "text or regex (grep)" }))?.trim();
  if (!pattern) return;
  const hits = run(alias, grepScript(dir, pattern), 120).then((out) => parseGrep(out, dir));
  const pick = await quickPick(
    hits.then((hs) => hs.map((h) => ({ label: h.text.trim().slice(0, 200) || "(blank)", description: `${h.path.slice(dir.length + 1)}:${h.line}`, value: h }))),
    { title: `“${pattern}” on ${alias}` },
  );
  if (pick) await openRemote(alias, pick.path, pick.line);
}

export async function forwardPort(alias: string): Promise<void> {
  const listening = run(alias, PORTS_SCRIPT, 20).then(parseListening).catch(() => [] as number[]);
  const choice = await quickPick(
    listening.then((ports) => [
      ...ports.map((p) => ({ label: `${p}`, description: "listening on the host", value: p })),
      { label: "Another port…", value: -1 },
    ]),
    { title: `Forward a port from ${alias}` },
  );
  if (choice === undefined) return;
  const remote = choice === -1 ? Number(await inputBox({ title: "Remote port", placeholder: "3000" })) : choice;
  if (!remote || remote < 1 || remote > 65535) return;
  const local = Number((await inputBox({ title: `Local port for ${alias}:${remote}`, value: String(remote >= 1024 ? remote : remote + 10000) })) ?? 0);
  if (!local || local < 1 || local > 65535) return;
  await startForward(alias, local, remote);
}

export async function startForward(alias: string, local: number, remote: number): Promise<void> {
  const key = `${alias}:${local}:${remote}`;
  if (useRemoteStore.getState().forwards.some((f) => f.key === key)) return;
  const handle = await native.shellBgSpawn(line(forwardArgv(alias, local, remote, opts(alias))), null);
  const f: Forward = { key, host: alias, local, remote, handle, status: "starting" };
  useRemoteStore.setState((s) => ({ forwards: [...s.forwards, f] }));
  // ssh -N prints nothing on success; if it hasn't exited after a moment the tunnel is up.
  await new Promise((res) => setTimeout(res, 1500));
  const logs = await native.shellBgLogs(handle).catch(() => null);
  const update = (patch: Partial<Forward>) => useRemoteStore.setState((s) => ({ forwards: s.forwards.map((x) => (x.key === key ? { ...x, ...patch } : x)) }));
  if (logs?.exited) {
    update({ status: "failed", error: logs.bytes.trim().split("\n").pop() || `ssh exited with ${logs.exit_code}` });
    toast.error(`Forward ${local} → ${alias}:${remote} failed`, { description: logs.bytes.trim() });
  } else {
    update({ status: "up" });
    toast.success(`localhost:${local} → ${alias}:${remote}`, { action: { label: "Open", onClick: () => app().openPreview(`http://localhost:${local}`) } });
  }
}

export async function stopForward(key: string): Promise<void> {
  const f = useRemoteStore.getState().forwards.find((x) => x.key === key);
  if (!f) return;
  await native.shellBgKill(f.handle).catch(() => {});
  useRemoteStore.setState((s) => ({ forwards: s.forwards.filter((x) => x.key !== key) }));
}

export type { RemoteEntry };
