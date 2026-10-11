// Remote development over the system OpenSSH client: ~/.ssh/config parsing,
// the ssh / sftp command lines, portable POSIX scripts for listing and
// changing files on the remote, and parsers for their output.

export interface SshHost {
  alias: string;
  hostName?: string;
  user?: string;
  port?: number;
  identityFile?: string;
  proxyJump?: string;
}

/** Concrete hosts from an ssh_config (wildcard patterns are skipped; `Host *` defaults are not merged). */
export function parseSshConfig(text: string): SshHost[] {
  const hosts: SshHost[] = [];
  let current: SshHost[] = [];
  let inMatch = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, "").trim();
    if (!line) continue;
    const m = /^(\S+?)\s*(?:=\s*|\s+)(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim().replace(/^"(.*)"$/, "$1");
    if (key === "host") {
      inMatch = false;
      current = value
        .split(/\s+/)
        .filter((a) => a && !/[*?!]/.test(a))
        .map((alias) => {
          const existing = hosts.find((h) => h.alias === alias);
          if (existing) return existing;
          const h: SshHost = { alias };
          hosts.push(h);
          return h;
        });
      continue;
    }
    if (key === "match") {
      inMatch = true;
      current = [];
      continue;
    }
    if (inMatch) continue;
    // First value wins, as in ssh itself.
    for (const h of current) {
      if (key === "hostname" && h.hostName === undefined) h.hostName = value;
      else if (key === "user" && h.user === undefined) h.user = value;
      else if (key === "port" && h.port === undefined) h.port = Number(value) || undefined;
      else if (key === "identityfile" && h.identityFile === undefined) h.identityFile = value;
      else if (key === "proxyjump" && h.proxyJump === undefined) h.proxyJump = value;
    }
  }
  return hosts;
}

/** `user@host:port` or an alias → the destination ssh understands, plus a port flag. */
export function parseDestination(s: string): { dest: string; port?: number } | null {
  const t = s.trim().replace(/^ssh:\/\//, "");
  const m = /^(?:([^@\s]+)@)?(\[[^\]]+\]|[^:\s/]+)(?::(\d+))?\/?$/.exec(t);
  if (!m) return null;
  const host = m[2].replace(/^\[|\]$/g, "");
  return { dest: m[1] ? `${m[1]}@${host}` : host, port: m[3] ? Number(m[3]) : undefined };
}

/** Quote for the remote POSIX shell. */
export function posixQuote(s: string): string {
  return /^[A-Za-z0-9_\-./:=@%+,]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`;
}

export interface SshOptions {
  port?: number;
  /** Reuse one connection (ControlMaster) — not supported by Windows OpenSSH. */
  multiplex: boolean;
  /** Fail instead of prompting (commands run without a terminal). */
  batch: boolean;
}

export function sshOptions(o: SshOptions): string[] {
  const out = ["-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15"];
  if (o.batch) out.push("-o", "BatchMode=yes");
  if (o.multiplex) out.push("-o", "ControlMaster=auto", "-o", "ControlPath=~/.ssh/cm-gear-%C", "-o", "ControlPersist=600");
  return out;
}

/**
 * Wrap a script so it survives any host shell: base64 has no quotes or
 * specials (Windows PowerShell 5.1 mangles `"` inside native arguments).
 * Falls back to BSD/macOS `base64 -D`.
 */
export function encodeScript(script: string): string {
  const b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(script))) : Buffer.from(script, "utf8").toString("base64");
  return `echo ${b64} | { base64 -d 2>/dev/null || base64 -D; } | sh`;
}

/** ssh argv running `script` with the remote user's shell. */
export function sshArgv(dest: string, script: string, o: SshOptions, tty = false): string[] {
  return ["ssh", ...sshOptions(o), ...(o.port ? ["-p", String(o.port)] : []), ...(tty ? ["-t"] : []), dest, script];
}

export function sftpArgv(dest: string, batchFile: string, o: SshOptions): string[] {
  return ["sftp", "-q", ...sshOptions(o), ...(o.port ? ["-P", String(o.port)] : []), "-b", batchFile, dest];
}

/** One sftp batch argument: double-quoted with `\` and `"` escaped. */
export function sftpQuote(p: string): string {
  return `"${p.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function sftpBatch(lines: [verb: "get" | "put", from: string, to: string][]): string {
  return `${lines.map(([v, a, b]) => `${v} ${sftpQuote(a)} ${sftpQuote(b)}`).join("\n")}\n`;
}

// ── remote scripts (POSIX sh; work on GNU, BSD/macOS and busybox) ──────────

export const PROBE = 'printf "%s\\n%s\\n%s\\n" "$(uname -sm)" "$HOME" "${SHELL:-/bin/sh}"';

export function parseProbe(out: string): { system: string; home: string; shell: string } {
  const [system = "", home = "/", shell = "/bin/sh"] = out.trim().split(/\r?\n/);
  return { system, home, shell };
}

/** List a directory: `type<TAB>size<TAB>name` per entry (d dir, f file, l link, L link to dir). */
export function listScript(dir: string): string {
  return [
    `cd -- ${posixQuote(dir)} || exit 3`,
    `for f in * .[!.]* ..?*; do`,
    `  [ -e "$f" ] || [ -L "$f" ] || continue`,
    `  if [ -L "$f" ]; then if [ -d "$f" ]; then t=L; else t=l; fi; s=0`,
    `  elif [ -d "$f" ]; then t=d; s=0`,
    `  else t=f; s=$(wc -c < "$f" 2>/dev/null | tr -d ' '); fi`,
    `  printf '%s\\t%s\\t%s\\n' "$t" "\${s:-0}" "$f"`,
    `done`,
  ].join("\n");
}

export interface RemoteEntry {
  name: string;
  kind: "dir" | "file" | "link";
  isDir: boolean;
  size: number;
}

export function parseList(out: string): RemoteEntry[] {
  const entries: RemoteEntry[] = [];
  for (const line of out.split("\n")) {
    const m = /^([dflL])\t(\d+)\t(.+)$/.exec(line.replace(/\r$/, ""));
    if (!m) continue;
    entries.push({ name: m[3], kind: m[1] === "d" ? "dir" : m[1] === "f" ? "file" : "link", isDir: m[1] === "d" || m[1] === "L", size: Number(m[2]) });
  }
  return entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) : a.isDir ? -1 : 1));
}

/** POSIX cksum of a file ("crc size"), or "missing". Used to detect remote changes before saving. */
export function cksumScript(path: string): string {
  return `if [ -f ${posixQuote(path)} ]; then cksum < ${posixQuote(path)}; else echo missing; fi`;
}

export function parseCksum(out: string): string {
  const t = out.trim();
  return t === "missing" ? "missing" : (/^(\d+)\s+(\d+)/.exec(t)?.slice(1, 3).join(" ") ?? t);
}

export type FileOp = { op: "mkdir"; path: string } | { op: "touch"; path: string } | { op: "rename"; from: string; to: string } | { op: "delete"; path: string };

/** A script for one file operation; refuses to clobber an existing target (exit 17). */
export function opScript(o: FileOp): string {
  switch (o.op) {
    case "mkdir":
      return `mkdir -p -- ${posixQuote(o.path)}`;
    case "touch":
      return `if [ -e ${posixQuote(o.path)} ]; then echo "already exists" >&2; exit 17; fi; : > ${posixQuote(o.path)}`;
    case "rename":
      return `if [ -e ${posixQuote(o.to)} ]; then echo "already exists" >&2; exit 17; fi; mv -- ${posixQuote(o.from)} ${posixQuote(o.to)}`;
    case "delete":
      if (/^\/*$/.test(o.path) || o.path.split("/").filter(Boolean).length < 2) throw new Error(`Refusing to delete ${o.path}`);
      return `rm -rf -- ${posixQuote(o.path)}`;
  }
}

/** A terminal on the host, starting in `dir`. */
export function shellScript(dir: string | null): string {
  return dir ? `cd -- ${posixQuote(dir)} 2>/dev/null; exec \${SHELL:-/bin/sh} -l` : "exec ${SHELL:-/bin/sh} -l";
}

/** Search file contents under `dir` (grep -rnI, capped). */
export function grepScript(dir: string, pattern: string, max = 500): string {
  return `cd -- ${posixQuote(dir)} && grep -rnI --exclude-dir=.git --exclude-dir=node_modules -e ${posixQuote(pattern)} . 2>/dev/null | head -n ${max}`;
}

export function parseGrep(out: string, dir: string): { path: string; line: number; text: string }[] {
  const base = dir.replace(/\/+$/, "");
  return out
    .split("\n")
    .map((l) => /^\.\/(.+?):(\d+):(.*)$/.exec(l.replace(/\r$/, "")))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ path: `${base}/${m[1]}`, line: Number(m[2]), text: m[3] }));
}

/** Listening TCP ports on the remote (ss, else netstat). */
export const PORTS_SCRIPT = "(ss -ltnH 2>/dev/null || netstat -ltn 2>/dev/null) | cat";

export function parseListening(out: string): number[] {
  const ports = new Set<number>();
  for (const line of out.split("\n")) {
    // ss: "LISTEN 0 4096 127.0.0.1:5432 0.0.0.0:*"; netstat: "tcp 0 0 0.0.0.0:22 0.0.0.0:* LISTEN"
    if (!/LISTEN/i.test(line)) continue;
    const local = line.trim().split(/\s+/).find((f) => /[:.]\d+$/.test(f) && !/\*$/.test(f));
    const m = local && /[:.](\d+)$/.exec(local);
    if (m) ports.add(Number(m[1]));
  }
  return [...ports].sort((a, b) => a - b);
}

export function forwardArgv(dest: string, local: number, remote: number, o: SshOptions, remoteHost = "localhost"): string[] {
  return ["ssh", ...sshOptions({ ...o, multiplex: false }), ...(o.port ? ["-p", String(o.port)] : []), "-N", "-o", "ExitOnForwardFailure=yes", "-L", `127.0.0.1:${local}:${remoteHost}:${remote}`, dest];
}

// ── local mirrors ─────────────────────────────────────────────────────────

/** Where a remote file is mirrored locally for editing. */
export function mirrorPath(cacheRoot: string, host: string, remotePath: string): string {
  const safeHost = host.replace(/[^\w.@-]/g, "_");
  const rel = remotePath.replace(/^\/+/, "").split("/").map((s) => s.replace(/[<>:"|?*\\]/g, "_")).join("/");
  return `${cacheRoot.replace(/\/+$/, "")}/${safeHost}/${rel}`;
}

export function joinRemote(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, "")}/${name}`;
}

export function parentRemote(p: string): string {
  const s = p.replace(/\/+$/, "");
  const i = s.lastIndexOf("/");
  return i <= 0 ? "/" : s.slice(0, i);
}
