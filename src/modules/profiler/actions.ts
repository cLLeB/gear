// Record and open CPU profiles: Node (--cpu-prof, also via NODE_OPTIONS for
// any command that spawns node), Python (py-spy), attach to a running PID.
// The recording runs in a terminal; the profile opens when it's written.

import { invoke } from "@tauri-apps/api/core";
import { appCacheDir } from "@tauri-apps/api/path";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { IS_WINDOWS } from "@/lib/platform";
import { quoteShellArg } from "@/lib/shellQuote";
import { native } from "@/modules/ai/lib/native";
import { pythonFor } from "@/modules/debug/store";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { inputBox, quickPick } from "@/modules/quick-pick";

const PROFILE_RE = /\.(cpuprofile|speedscope\.json|folded|collapsed|heapsnapshot)$/i;

async function outDir(): Promise<string> {
  const base = (await appCacheDir()).replace(/\\/g, "/").replace(/\/+$/, "");
  const dir = `${base}/profiles/${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await native.createDir(dir).catch(() => {});
  return dir;
}

/** Wait for the first profile to appear in `dir`, then open it. */
function openWhenWritten(dir: string, minutes = 120): void {
  const started = Date.now();
  let lastSize = -1;
  const tick = async () => {
    if (Date.now() - started > minutes * 60_000) return;
    const entries = await native.readDir(dir).catch(() => []);
    const hit = entries.filter((e) => e.kind === "file" && PROFILE_RE.test(e.name)).sort((a, b) => b.size - a.size)[0];
    // Wait until the file stops growing (V8 writes it at exit in one go; py-spy at the end too).
    if (hit && hit.size > 0 && hit.size === lastSize) {
      const path = `${dir}/${hit.name}`;
      toast.success("Profile recorded", { action: { label: "Open", onClick: () => app().openFile(path) } });
      app().openFile(path);
      return;
    }
    lastSize = hit?.size ?? -1;
    setTimeout(() => void tick(), 1500);
  };
  setTimeout(() => void tick(), 1500);
}

const q = (s: string) => quoteShellArg(s);

function runInTerminal(command: string, cwd: string | null): void {
  app().openTerminal({ cwd: cwd ?? app().workspaceRoot() ?? null, command });
}

async function hasCommand(cmd: string): Promise<boolean> {
  return !!(await invoke<string | null>("lsp_detect", { command: cmd }).catch(() => null));
}

async function profileCurrentFile(): Promise<void> {
  const path = getActiveEditor()?.path?.replace(/\\/g, "/");
  if (!path) return void toast.info("Open a script first");
  const cwd = path.replace(/\/[^/]*$/, "");
  const dir = await outDir();
  if (/\.(m?js|cjs)$/.test(path)) {
    runInTerminal(`node --cpu-prof --cpu-prof-dir=${q(dir)} ${q(path)}`, cwd);
  } else if (/\.(m?ts|tsx)$/.test(path)) {
    runInTerminal(`node --cpu-prof --cpu-prof-dir=${q(dir)} --import tsx ${q(path)}`, cwd);
  } else if (/\.py$/.test(path)) {
    if (!(await hasCommand("py-spy"))) return void toast.error("Python profiling uses py-spy", { description: "Install it with: pip install py-spy" });
    const py = (await pythonFor(cwd)) ?? "python";
    runInTerminal(`py-spy record -f speedscope -r 250 -o ${q(`${dir}/profile.speedscope.json`)} -- ${q(py)} ${q(path)}`, cwd);
  } else return void toast.info("Profiling works for JavaScript / TypeScript (Node) and Python files");
  toast.info("Recording… the profile opens when the program exits");
  openWhenWritten(dir);
}

async function profileCommand(): Promise<void> {
  const kind = await quickPick(
    [
      { label: "Node.js — any command that runs node (npm scripts, tests, servers)", value: "node" as const },
      { label: "Python — a command under py-spy", value: "python" as const },
    ],
    { title: "Profile a command" },
  );
  if (!kind) return;
  const cmd = await inputBox({ title: "Command to profile", placeholder: kind === "node" ? "npm run build · npx vitest run · node server.js" : "python manage.py migrate · pytest -x" });
  if (!cmd) return;
  const dir = await outDir();
  const cwd = app().activeCwd() ?? app().workspaceRoot() ?? null;
  if (kind === "node") {
    // NODE_OPTIONS reaches every node process the command starts; each writes its own profile.
    const opts = `--cpu-prof --cpu-prof-dir="${dir}"`;
    runInTerminal(IS_WINDOWS ? `$env:NODE_OPTIONS='${opts}'; ${cmd}; Remove-Item Env:NODE_OPTIONS` : `NODE_OPTIONS=${q(opts)} ${cmd}`, cwd);
  } else {
    if (!(await hasCommand("py-spy"))) return void toast.error("Install py-spy first: pip install py-spy");
    runInTerminal(`py-spy record -f speedscope -r 250 -o ${q(`${dir}/profile.speedscope.json`)} -- ${cmd}`, cwd);
  }
  toast.info("Recording… the profile opens when the command exits");
  openWhenWritten(dir);
}

async function attachPython(): Promise<void> {
  if (!(await hasCommand("py-spy"))) return void toast.error("Install py-spy first: pip install py-spy");
  const ps = await native.runCommand(IS_WINDOWS ? "Get-Process python*,py | Select-Object Id,ProcessName,Path | ConvertTo-Csv -NoTypeInformation" : "ps -eo pid,args | grep -i [p]ython", null, 10).catch(() => null);
  const rows = (ps?.stdout ?? "")
    .split(/\r?\n/)
    .map((l) => (IS_WINDOWS ? /^"(\d+)","([^"]*)","?([^"]*)"?/.exec(l) : /^\s*(\d+)\s+(.*)$/.exec(l)))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ pid: m[1], label: (m[3] || m[2]).slice(0, 140) }));
  const pid = await quickPick([...rows.map((r) => ({ label: r.pid, description: r.label, value: r.pid })), { label: "Enter a PID…", value: "" }], { title: "Attach py-spy to which Python process?" });
  if (pid === undefined) return;
  const target = pid || (await inputBox({ title: "PID" }));
  if (!target) return;
  const secs = await quickPick([10, 30, 60].map((n) => ({ label: `${n} seconds`, value: n })), { title: "Record for" });
  if (!secs) return;
  const dir = await outDir();
  runInTerminal(`${IS_WINDOWS ? "" : "sudo "}py-spy record -f speedscope -r 250 -d ${secs} -p ${target} -o ${q(`${dir}/profile.speedscope.json`)}`, null);
  toast.info(`Recording ${secs}s from PID ${target}…`);
  openWhenWritten(dir, 10);
}

async function openProfile(): Promise<void> {
  const root = app().workspaceRoot();
  const hits = root ? ((await native.glob({ pattern: "**/*.{cpuprofile,folded,collapsed,heapsnapshot}", root, maxResults: 200 }).catch(() => null))?.hits ?? []) : [];
  const ss = root ? ((await native.glob({ pattern: "**/*.speedscope.json", root, maxResults: 200 }).catch(() => null))?.hits ?? []) : [];
  const cache = `${(await appCacheDir()).replace(/\\/g, "/").replace(/\/+$/, "")}/profiles`;
  const recent = await native.glob({ pattern: "**/*.{cpuprofile,json}", root: cache, maxResults: 50 }).catch(() => null);
  const pick = await quickPick(
    [
      ...(recent?.hits ?? []).filter((h) => PROFILE_RE.test(h.path)).reverse().map((h) => ({ label: h.rel, description: "recorded in Gear", value: h.path })),
      ...[...hits, ...ss].filter((h) => !/node_modules/.test(h.rel)).map((h) => ({ label: h.rel, description: "workspace", value: h.path })),
      { label: "Enter a path…", value: "" },
    ],
    { title: "Open a profile (.cpuprofile, speedscope, collapsed stacks, .heapsnapshot)" },
  );
  if (pick === undefined) return;
  const path = pick || (await inputBox({ title: "Profile path" }));
  if (path) app().openFile(path);
}

// ── heap snapshots ────────────────────────────────────────────────────────

/** Run a Node script that writes a heap snapshot each time it gets SIGUSR2. */
async function heapRun(): Promise<void> {
  if (IS_WINDOWS) return void toast.info("Signal-triggered snapshots need macOS or Linux", { description: "On Windows, call require('v8').writeHeapSnapshot() from the script, or use Chrome DevTools with --inspect." });
  const path = getActiveEditor()?.path?.replace(/\\/g, "/");
  if (!path || !/\.(m?[jt]s|cjs|tsx)$/.test(path)) return void toast.info("Open a JavaScript / TypeScript entry file first");
  const cwd = path.replace(/\/[^/]*$/, "");
  runInTerminal(`node --heapsnapshot-signal=SIGUSR2 ${/\.tsx?$|\.mts$/.test(path) ? "--import tsx " : ""}${q(path)}`, cwd);
  toast.info("Running with heap snapshots on demand", { description: "Use “Profile: Take a heap snapshot of a Node process” now and again after the suspected leak, then compare them." });
}

/** Signal a running Node process (started with --heapsnapshot-signal) and open the snapshot it writes. */
async function heapSnapshotOf(): Promise<void> {
  if (IS_WINDOWS) return void toast.info("Signal-triggered snapshots need macOS or Linux");
  const { useProcStore, sample } = await import("@/modules/procs/store");
  await sample(true);
  const nodes = useProcStore.getState().procs.filter((p) => /(^|\/)node(js)?$/.test(p.name) || /^node\b/.test(p.args));
  const ready = nodes.filter((p) => p.args.includes("--heapsnapshot-signal"));
  const pid = await quickPick(
    [...ready, ...nodes.filter((p) => !ready.includes(p))].map((p) => ({ label: `${p.pid}  ${p.args.slice(0, 120)}`, description: ready.includes(p) ? "ready" : "not started with --heapsnapshot-signal", detail: p.cwd, value: p.pid })),
    { title: "Take a heap snapshot of…" },
  );
  if (pid === undefined) return;
  const proc = nodes.find((p) => p.pid === pid)!;
  if (!ready.includes(proc)) return void toast.error("That process can't be signalled for a snapshot", { description: "Start it with node --heapsnapshot-signal=SIGUSR2 (“Profile: Run this file with heap snapshots”)." });
  const signal = /--heapsnapshot-signal=(\w+)/.exec(proc.args)?.[1] ?? "SIGUSR2";
  const cwd = proc.cwd ?? app().workspaceRoot() ?? "";
  const before = new Set((await native.glob({ pattern: "*.heapsnapshot", root: cwd, maxResults: 500 }).catch(() => null))?.hits.map((h) => h.path) ?? []);
  const r = await native.runCommand(`kill -${signal.replace(/^SIG/, "")} ${pid}`, null, 10);
  if (r.exit_code !== 0) return void toast.error("Couldn't signal the process", { description: r.stderr });
  const t = toast.loading("Writing the heap snapshot…");
  // V8 writes Heap.<date>.<pid>.<n>.heapsnapshot into the process's working folder.
  for (let i = 0; i < 120; i++) {
    await new Promise((res) => setTimeout(res, 500));
    const hits = (await native.glob({ pattern: "*.heapsnapshot", root: cwd, maxResults: 500 }).catch(() => null))?.hits ?? [];
    const fresh = hits.find((h) => !before.has(h.path));
    if (fresh) {
      // Wait until the file stops growing.
      let size = -1;
      for (let k = 0; k < 120; k++) {
        const s = (await native.readDir(cwd).catch(() => [])).find((e) => fresh.path.endsWith(`/${e.name}`) || fresh.path.endsWith(`\\${e.name}`))?.size ?? 0;
        if (s > 0 && s === size) break;
        size = s;
        await new Promise((res) => setTimeout(res, 400));
      }
      toast.dismiss(t);
      app().openFile(fresh.path);
      return;
    }
  }
  toast.dismiss(t);
  toast.error("No snapshot appeared", { description: `Looked in ${cwd}` });
}

export const PROFILER_ACTIONS = [
  { id: "profiler.heapRun", label: "Profile: Run this file with heap snapshots on demand (Node)", keywords: ["heap", "memory", "leak", "snapshot", "heapsnapshot", "node"], run: () => void heapRun() },
  { id: "profiler.heapSnapshot", label: "Profile: Take a heap snapshot of a Node process…", keywords: ["heap", "memory", "leak", "snapshot", "heapsnapshot", "node", "signal"], run: () => void heapSnapshotOf() },
  { id: "profiler.currentFile", label: "Profile: Record a CPU profile of this file (Node / Python)", keywords: ["profile", "cpu", "flamegraph", "performance", "slow", "py-spy", "cpu-prof"], run: () => void profileCurrentFile() },
  { id: "profiler.command", label: "Profile: Record a command…", keywords: ["profile", "cpu", "flamegraph", "npm", "node", "python", "performance"], run: () => void profileCommand() },
  { id: "profiler.attach", label: "Profile: Attach to a running Python process (py-spy)…", keywords: ["profile", "attach", "pid", "py-spy", "live", "production"], run: () => void attachPython() },
  { id: "profiler.open", label: "Profile: Open a profile…", keywords: ["profile", "cpuprofile", "speedscope", "flamegraph", "open", "collapsed"], run: () => void openProfile() },
];
