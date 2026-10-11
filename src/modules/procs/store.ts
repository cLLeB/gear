// Samples listening ports and processes with the platform's own tools
// (ss / lsof / ps on Unix, CIM + Get-NetTCPConnection on Windows) and kills
// processes (one, or a whole tree).

import { toast } from "sonner";
import { create } from "zustand";
import { app } from "@/app/appBridge";
import { IS_MAC, IS_WINDOWS } from "@/lib/platform";
import { native } from "@/modules/ai/lib/native";
import { confirmPick, inputBox } from "@/modules/quick-pick";
import { parseCwds, parseLsof, parseNetTcp, parsePs, parseSs, parseWinProcs, type Listener, type Proc } from "./model";

interface ProcStore {
  procs: Proc[];
  ports: Listener[];
  cwds: Map<number, string>;
  error: string | null;
  sampledAt: number;
}

export const useProcStore = create<ProcStore>(() => ({ procs: [], ports: [], cwds: new Map(), error: null, sampledAt: 0 }));
export const PROCS_PATH = "gear-procs://Processes";

const PS = "ps -axo pid=,ppid=,pcpu=,pmem=,rss=,etime=,user=,comm=,args=";
const LINUX_CWDS = `for p in /proc/[0-9]*; do c=$(readlink "$p/cwd" 2>/dev/null) && printf '%s %s\\n' "\${p#/proc/}" "$c"; done`;
const WIN_PROCS = "$cpu=@{}; Get-Process | ForEach-Object { $cpu[$_.Id] = $_.CPU }; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize,@{n='CreationDate';e={$_.CreationDate.ToUniversalTime().ToString('o')}},@{n='CPU';e={$cpu[[int]$_.ProcessId]}} | ConvertTo-Json -Compress";
const WIN_PORTS = "Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress";
const WIN_INFO = "$c=Get-CimInstance Win32_ComputerSystem; \"$($c.NumberOfLogicalProcessors) $([math]::Round($c.TotalPhysicalMemory/1024))\"";

const winPrev = new Map<number, { cpu: number; at: number }>();
let winInfo: { cores: number; memKb: number } | null = null;
let lastCwd = 0;

async function sh(cmd: string, timeout = 20): Promise<string> {
  const r = await native.runCommand(cmd, null, timeout);
  if (r.exit_code !== 0 && !r.stdout) throw new Error(r.stderr.trim() || `exit ${r.exit_code}`);
  return r.stdout;
}

export async function sample(withCwd = false): Promise<void> {
  try {
    let procs: Proc[];
    let ports: Listener[];
    if (IS_WINDOWS) {
      if (!winInfo) {
        const [cores, mem] = (await sh(WIN_INFO)).trim().split(/\s+/).map(Number);
        winInfo = { cores: cores || 1, memKb: mem || 0 };
      }
      procs = parseWinProcs(await sh(WIN_PROCS, 30), winPrev, Date.now(), winInfo.cores, winInfo.memKb);
      ports = parseNetTcp(await sh(WIN_PORTS).catch(() => "[]"), procs);
    } else {
      const [ps, ss] = await Promise.all([sh(PS), IS_MAC ? Promise.resolve("") : sh("ss -ltnpH").catch(() => "")]);
      procs = parsePs(ps);
      ports = ss.trim() ? parseSs(ss) : parseLsof(await sh("lsof -nP -iTCP -sTCP:LISTEN -F pcn").catch(() => ""));
      // ss shows no owner for other users' sockets: lsof sometimes can.
      if (ports.some((p) => p.pid === null) && !IS_MAC) {
        const more = parseLsof(await sh("lsof -nP -iTCP -sTCP:LISTEN -F pcn").catch(() => ""));
        ports = ports.map((p) => (p.pid === null ? (more.find((m) => m.port === p.port) ?? p) : p));
      }
    }
    for (const l of ports) if (l.pid && !l.command) l.command = procs.find((p) => p.pid === l.pid)?.name ?? null;
    let cwds = useProcStore.getState().cwds;
    if (!IS_WINDOWS && (withCwd || Date.now() - lastCwd > 10_000)) {
      lastCwd = Date.now();
      cwds = parseCwds(await sh(IS_MAC ? "lsof -d cwd -F pn" : LINUX_CWDS, 30).catch(() => ""));
    }
    for (const p of procs) p.cwd = cwds.get(p.pid);
    useProcStore.setState({ procs, ports, cwds, error: null, sampledAt: Date.now() });
  } catch (e) {
    useProcStore.setState({ error: String((e as Error).message ?? e) });
  }
}

/** pid and every descendant, children first. */
export function descendants(pid: number): number[] {
  const { procs } = useProcStore.getState();
  const out: number[] = [];
  const walk = (p: number) => {
    for (const c of procs.filter((x) => x.ppid === p && x.pid !== p)) walk(c.pid);
    out.push(p);
  };
  walk(pid);
  return out;
}

export async function kill(pid: number, opts: { force?: boolean; tree?: boolean; confirm?: boolean } = {}): Promise<void> {
  const p = useProcStore.getState().procs.find((x) => x.pid === pid);
  const pids = opts.tree ? descendants(pid) : [pid];
  if (opts.confirm !== false && !(await confirmPick(`${opts.force ? "Force kill" : "Stop"} ${p?.name ?? pid} (${pid})${pids.length > 1 ? ` and ${pids.length - 1} child process${pids.length > 2 ? "es" : ""}` : ""}?`, opts.force ? "Kill" : "Stop", p?.args.slice(0, 200)))) return;
  const cmd = IS_WINDOWS ? (opts.tree ? `taskkill /T ${opts.force ? "/F " : ""}/PID ${pid}` : `Stop-Process -Id ${pid}${opts.force ? " -Force" : ""}`) : `kill -${opts.force ? "KILL" : "TERM"} ${pids.join(" ")}`;
  const r = await native.runCommand(cmd, null, 20);
  if (r.exit_code !== 0) toast.error(`Couldn't ${opts.force ? "kill" : "stop"} ${pid}`, { description: (r.stderr || r.stdout).trim(), action: !opts.force ? { label: "Force kill", onClick: () => void kill(pid, { ...opts, force: true, confirm: false }) } : undefined });
  else toast.success(`${opts.force ? "Killed" : "Stopped"} ${p?.name ?? pid}`);
  setTimeout(() => void sample(), 400);
}

/** "Something is already using port 3000": find it and offer to stop it. */
export async function killPort(): Promise<void> {
  const v = await inputBox({ title: "Stop the process listening on port…", placeholder: "3000" });
  const port = Number(v);
  if (!port) return;
  await sample();
  const hits = useProcStore.getState().ports.filter((l) => l.port === port);
  if (!hits.length) return void toast.info(`Nothing is listening on port ${port}`);
  const owner = hits.find((h) => h.pid);
  if (!owner?.pid) return void toast.error(`Port ${port} is in use, but its process isn't visible (another user or container?)`);
  await kill(owner.pid, { tree: false });
}

export function openProcesses(): void {
  app().openFile(PROCS_PATH);
}
