// Ports & processes: parsers for `ss -ltnpH`, `lsof -F pcn`, `ps -axo …` and
// Windows CIM / NetTCPConnection JSON; CPU % from two samples on Windows;
// building and filtering the process tree.

export interface Listener {
  port: number;
  address: string;
  pid: number | null;
  command: string | null;
}

export interface Proc {
  pid: number;
  ppid: number;
  cpu: number;
  mem: number;
  rssKb: number;
  elapsedSec: number;
  user: string;
  name: string;
  args: string;
  cwd?: string;
}

const addrPort = (s: string): { address: string; port: number } | null => {
  const m = /^(.*)[:.](\d+)$/.exec(s.trim());
  return m ? { address: m[1].replace(/^\[|\]$/g, "") || "*", port: Number(m[2]) } : null;
};

/** `ss -ltnpH` (Linux). Processes are only shown for sockets we may see. */
/** Output that came through a terminal or SSH ends its lines with CRLF. */
const lf = (s: string): string => s.replace(/\r\n?/g, "\n");

export function parseSs(text: string): Listener[] {
  text = lf(text);
  const out: Listener[] = [];
  for (const line of text.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f[0] !== "LISTEN" || f.length < 4) continue;
    const ap = addrPort(f[3]);
    if (!ap) continue;
    const users = /users:\(\("([^"]+)",pid=(\d+)/.exec(line);
    out.push({ ...ap, pid: users ? Number(users[2]) : null, command: users ? users[1] : null });
  }
  return dedupe(out);
}

/** `lsof -nP -iTCP -sTCP:LISTEN -F pcn` (macOS / Linux fallback). */
export function parseLsof(text: string): Listener[] {
  text = lf(text);
  const out: Listener[] = [];
  let pid: number | null = null;
  let cmd: string | null = null;
  for (const line of text.split("\n")) {
    const tag = line[0];
    const v = line.slice(1).trim();
    if (tag === "p") pid = Number(v);
    else if (tag === "c") cmd = v;
    else if (tag === "n") {
      const ap = addrPort(v.replace(/->.*$/, ""));
      if (ap) out.push({ ...ap, pid, command: cmd });
    }
  }
  return dedupe(out);
}

/** Windows: Get-NetTCPConnection -State Listen | Select LocalAddress, LocalPort, OwningProcess | ConvertTo-Json */
export function parseNetTcp(json: string, procs: Proc[]): Listener[] {
  const raw = JSON.parse(json || "[]") as { LocalAddress: string; LocalPort: number; OwningProcess: number } | { LocalAddress: string; LocalPort: number; OwningProcess: number }[];
  const list = Array.isArray(raw) ? raw : [raw];
  return dedupe(list.map((r) => ({ port: r.LocalPort, address: r.LocalAddress, pid: r.OwningProcess || null, command: procs.find((p) => p.pid === r.OwningProcess)?.name ?? null })));
}

/** One row per (port, pid); IPv4 and IPv6 wildcard listeners merge. */
function dedupe(ls: Listener[]): Listener[] {
  const seen = new Map<string, Listener>();
  for (const l of ls) {
    const k = `${l.port}:${l.pid ?? "?"}`;
    const prev = seen.get(k);
    if (!prev) seen.set(k, l);
    else if (prev.address !== l.address && !prev.address.includes(l.address)) prev.address = `${prev.address}, ${l.address}`;
  }
  return [...seen.values()].sort((a, b) => a.port - b.port);
}

/** `[[dd-]hh:]mm:ss` → seconds. */
export function parseEtime(s: string): number {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(s.trim());
  if (!m) return Number(s) || 0;
  return (Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

/** `ps -axo pid=,ppid=,pcpu=,pmem=,rss=,etime=,user=,comm=,args=` (Linux and macOS). */
export function parsePs(text: string): Proc[] {
  text = lf(text);
  const out: Proc[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.,]+)\s+([\d.,]+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const rest = m[8];
    // comm is padded to a fixed width on Linux and may contain spaces on macOS: take it from args.
    const firstArg = rest.trim().split(/\s{2,}/);
    const args = firstArg.length > 1 ? firstArg.slice(1).join("  ") : rest.trim();
    const comm = firstArg.length > 1 ? firstArg[0] : (args.split(/\s+/)[0] ?? "");
    out.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      cpu: Number(m[3].replace(",", ".")),
      mem: Number(m[4].replace(",", ".")),
      rssKb: Number(m[5]),
      elapsedSec: parseEtime(m[6]),
      user: m[7],
      name: comm.split("/").pop() ?? comm,
      args,
    });
  }
  return out;
}

export interface WinProc {
  ProcessId: number;
  ParentProcessId: number;
  Name: string;
  CommandLine: string | null;
  WorkingSetSize: number;
  CreationDate: string | null;
  /** Total CPU seconds (Get-Process). */
  CPU?: number | null;
  UserName?: string | null;
}

/** Windows CIM processes; CPU % comes from the change in CPU seconds since the last sample. */
export function parseWinProcs(json: string, prev: Map<number, { cpu: number; at: number }>, now: number, cores: number, totalMemKb: number): Proc[] {
  const raw = JSON.parse(json || "[]") as WinProc | WinProc[];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((p) => {
    const before = prev.get(p.ProcessId);
    const cpuSecs = p.CPU ?? 0;
    const cpu = before && now > before.at ? Math.max(0, ((cpuSecs - before.cpu) / ((now - before.at) / 1000) / Math.max(1, cores)) * 100) : 0;
    prev.set(p.ProcessId, { cpu: cpuSecs, at: now });
    const created = p.CreationDate ? Date.parse(p.CreationDate.replace(/^\/Date\((\d+)\)\/$/, (_, ms) => new Date(Number(ms)).toISOString())) : NaN;
    const rssKb = Math.round((p.WorkingSetSize ?? 0) / 1024);
    return {
      pid: p.ProcessId,
      ppid: p.ParentProcessId,
      cpu: Math.round(cpu * 10) / 10,
      mem: totalMemKb ? Math.round((rssKb / totalMemKb) * 1000) / 10 : 0,
      rssKb,
      elapsedSec: Number.isFinite(created) ? Math.max(0, Math.round((now - created) / 1000)) : 0,
      user: p.UserName ?? "",
      name: p.Name,
      args: p.CommandLine ?? p.Name,
    };
  });
}

/** `pid cwd` lines (from each /proc/<pid>/cwd link) or `lsof -d cwd -F pn` output. */
export function parseCwds(text: string): Map<number, string> {
  text = lf(text);
  const out = new Map<number, string>();
  let pid: number | null = null;
  for (const line of text.split("\n")) {
    const plain = /^(\d+) (.+)$/.exec(line);
    if (plain) out.set(Number(plain[1]), plain[2]);
    else if (line[0] === "p") pid = Number(line.slice(1));
    else if (line[0] === "n" && pid !== null) out.set(pid, line.slice(1));
  }
  return out;
}

export interface TreeRow {
  proc: Proc;
  depth: number;
  /** Sum over the subtree. */
  cpuTotal: number;
  rssTotal: number;
  children: number;
}

/** Depth-first rows; `collapsed` pids hide their descendants; siblings sorted by `sort`. */
export function processTree(procs: Proc[], sort: "cpu" | "mem" | "pid" | "name", collapsed: Set<number>): TreeRow[] {
  const kids = new Map<number, Proc[]>();
  const pids = new Set(procs.map((p) => p.pid));
  for (const p of procs) {
    const parent = pids.has(p.ppid) && p.ppid !== p.pid ? p.ppid : 0;
    kids.set(parent, [...(kids.get(parent) ?? []), p]);
  }
  const totals = new Map<number, { cpu: number; rss: number; n: number }>();
  const total = (p: Proc): { cpu: number; rss: number; n: number } => {
    const cached = totals.get(p.pid);
    if (cached) return cached;
    const t = { cpu: p.cpu, rss: p.rssKb, n: 0 };
    totals.set(p.pid, t);
    for (const c of kids.get(p.pid) ?? []) {
      const ct = total(c);
      t.cpu += ct.cpu;
      t.rss += ct.rss;
      t.n += ct.n + 1;
    }
    return t;
  };
  const cmp = (a: Proc, b: Proc) => (sort === "cpu" ? total(b).cpu - total(a).cpu : sort === "mem" ? total(b).rss - total(a).rss : sort === "name" ? a.name.localeCompare(b.name) : a.pid - b.pid);
  const out: TreeRow[] = [];
  const walk = (parent: number, depth: number, seen: Set<number>) => {
    for (const p of [...(kids.get(parent) ?? [])].sort(cmp)) {
      if (seen.has(p.pid)) continue;
      seen.add(p.pid);
      const t = total(p);
      out.push({ proc: p, depth, cpuTotal: t.cpu, rssTotal: t.rss, children: t.n });
      if (!collapsed.has(p.pid)) walk(p.pid, depth + 1, seen);
    }
  };
  walk(0, 0, new Set());
  return out;
}

/** Matching processes plus their ancestors (so the tree stays readable). */
export function filterProcs(procs: Proc[], query: string, onlyPids?: Set<number>): Proc[] {
  const q = query.trim().toLowerCase();
  if (!q && !onlyPids) return procs;
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const keep = new Set<number>();
  for (const p of procs) {
    const hit = (!q || `${p.pid} ${p.name} ${p.args} ${p.user}`.toLowerCase().includes(q)) && (!onlyPids || onlyPids.has(p.pid));
    if (!hit) continue;
    for (let x: Proc | undefined = p, guard = 0; x && !keep.has(x.pid) && guard < 64; x = byPid.get(x.ppid), guard++) keep.add(x.pid);
  }
  return procs.filter((p) => keep.has(p.pid));
}

export function formatKb(kb: number): string {
  return kb < 1024 ? `${kb} KB` : kb < 1024 * 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${(kb / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}

/** Well-known dev ports, for labelling. */
export const PORT_HINTS: Record<number, string> = { 3000: "dev server", 3306: "MySQL", 4200: "Angular", 5000: "Flask", 5173: "Vite", 5432: "PostgreSQL", 6379: "Redis", 8000: "Django / http.server", 8080: "HTTP", 8888: "Jupyter", 9000: "PHP-FPM / MinIO", 9229: "Node inspector", 27017: "MongoDB" };
