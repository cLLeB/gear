// The debugger's app-wide state and controller: persistent breakpoints and
// watches, running sessions (including js-debug child sessions), the debug
// console, and the commands the panel, editor and palette call.

import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { create } from "zustand";
import { app } from "@/app/appBridge";
import { IS_WINDOWS } from "@/lib/platform";
import { quoteShellArg } from "@/lib/shellQuote";
import { native } from "@/modules/ai/lib/native";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { quickPick } from "@/modules/quick-pick";
import { getFeature } from "@/modules/settings/useFeature";
import { currentWorkspaceEnv } from "@/modules/workspace/env";
import { DapClient } from "./dapClient";
import { DebugSession, type SessionState, type SourceBreakpoint, type StackFrame } from "./debugSession";
import { ADAPTERS, cargoBinaryName, defaultConfigFor, parseLaunchJson, resolveConfig, type AdapterKind, type LaunchConfig, type ResolvedConfig } from "./launchConfig";
import { freePort, stdioAdapter, tcpAdapter } from "./transports";

export interface ConsoleLine {
  id: number;
  category: string;
  text: string;
}

export interface SessionEntry {
  id: number;
  name: string;
  session: DebugSession;
  state: SessionState;
  parentId: number | null;
  config: ResolvedConfig;
}

interface DebugStore {
  breakpoints: Record<string, SourceBreakpoint[]>;
  exceptionFilters: string[];
  watches: string[];
  sessions: SessionEntry[];
  activeId: number | null;
  selectedFrameId: number | null;
  console: ConsoleLine[];
  lastConfig: ResolvedConfig | null;
  starting: boolean;
}

const BP_KEY = "gear-debug-breakpoints";
const WATCH_KEY = "gear-debug-watches";
const EXC_KEY = "gear-debug-exceptions";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export const useDebugStore = create<DebugStore>(() => ({
  breakpoints: load(BP_KEY, {}),
  exceptionFilters: load(EXC_KEY, ["uncaught", "raised_uncaught"]),
  watches: load(WATCH_KEY, []),
  sessions: [],
  activeId: null,
  selectedFrameId: null,
  console: [],
  lastConfig: null,
  starting: false,
}));

const norm = (p: string) => p.replace(/\\/g, "/");
let consoleId = 0;
let sessionId = 0;

export function logConsole(category: string, text: string): void {
  if (!text) return;
  useDebugStore.setState((s) => {
    const next = [...s.console, { id: ++consoleId, category, text }];
    return { console: next.length > 5000 ? next.slice(-5000) : next };
  });
}

export function clearConsole(): void {
  useDebugStore.setState({ console: [] });
}

// ── breakpoints ───────────────────────────────────────────────────────────

function breakpointMap(): Map<string, SourceBreakpoint[]> {
  return new Map(Object.entries(useDebugStore.getState().breakpoints));
}

function setFileBreakpoints(path: string, list: SourceBreakpoint[]): void {
  const p = norm(path);
  const all = { ...useDebugStore.getState().breakpoints };
  if (list.length) all[p] = [...list].sort((a, b) => a.line - b.line);
  else delete all[p];
  useDebugStore.setState({ breakpoints: all });
  save(BP_KEY, all);
  for (const e of useDebugStore.getState().sessions) if (e.state.status !== "ended") void e.session.syncBreakpoints(p);
}

export function breakpointsIn(path: string): SourceBreakpoint[] {
  return useDebugStore.getState().breakpoints[norm(path)] ?? [];
}

export function toggleBreakpoint(path: string, line: number): void {
  const list = breakpointsIn(path);
  const has = list.some((b) => b.line === line);
  setFileBreakpoints(path, has ? list.filter((b) => b.line !== line) : [...list, { line, enabled: true }]);
}

export function upsertBreakpoint(path: string, bp: SourceBreakpoint): void {
  setFileBreakpoints(path, [...breakpointsIn(path).filter((b) => b.line !== bp.line), bp]);
}

export function removeBreakpoint(path: string, line: number): void {
  setFileBreakpoints(path, breakpointsIn(path).filter((b) => b.line !== line));
}

export function setBreakpointEnabled(path: string, line: number, enabled: boolean): void {
  setFileBreakpoints(path, breakpointsIn(path).map((b) => (b.line === line ? { ...b, enabled } : b)));
}

/** Breakpoint lines moved by an edit (the editor maps them through its changes). */
export function moveBreakpoints(path: string, lines: { from: number; to: number }[]): void {
  const map = new Map(lines.map((l) => [l.from, l.to]));
  const list = breakpointsIn(path);
  const next = list.map((b) => ({ ...b, line: map.get(b.line) ?? b.line }));
  const dedup = [...new Map(next.map((b) => [b.line, b])).values()];
  if (JSON.stringify(dedup) !== JSON.stringify(list)) setFileBreakpoints(path, dedup);
}

export function removeAllBreakpoints(): void {
  const paths = Object.keys(useDebugStore.getState().breakpoints);
  useDebugStore.setState({ breakpoints: {} });
  save(BP_KEY, {});
  for (const e of useDebugStore.getState().sessions) for (const p of paths) void e.session.syncBreakpoints(p);
}

export function setExceptionFilters(filters: string[]): void {
  useDebugStore.setState({ exceptionFilters: filters });
  save(EXC_KEY, filters);
  for (const e of useDebugStore.getState().sessions) void e.session.syncExceptionFilters();
}

export function setWatches(watches: string[]): void {
  useDebugStore.setState({ watches });
  save(WATCH_KEY, watches);
}

// ── sessions ──────────────────────────────────────────────────────────────

export function activeEntry(): SessionEntry | null {
  const s = useDebugStore.getState();
  return s.sessions.find((e) => e.id === s.activeId) ?? null;
}

function patchEntry(id: number, patch: Partial<SessionEntry>): void {
  useDebugStore.setState((s) => ({ sessions: s.sessions.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
}

async function detect(command: string): Promise<string | null> {
  return invoke<string | null>("lsp_detect", { command }).catch(() => null);
}

function exists(path: string): Promise<boolean> {
  return invoke("fs_stat", { path, workspace: currentWorkspaceEnv() }).then(
    () => true,
    () => false,
  );
}

/** PowerShell needs `&` to call a quoted executable. */
function callExe(exe: string): string {
  return `${IS_WINDOWS ? "& " : ""}${quoteShellArg(exe)}`;
}

export async function pythonFor(cwd: string): Promise<string | null> {
  const configured = getFeature("debug.pythonPath");
  if (configured) return configured;
  for (const venv of [".venv", "venv", "env"]) {
    const p = IS_WINDOWS ? `${cwd}/${venv}/Scripts/python.exe` : `${cwd}/${venv}/bin/python`;
    if (await exists(p)) return p;
  }
  for (const c of ADAPTERS.python.commands) if (await detect(c)) return c;
  return null;
}

/** Which adapters are installed (cheap PATH checks). */
export async function availableAdapters(): Promise<Set<AdapterKind>> {
  const out = new Set<AdapterKind>();
  await Promise.all(
    (Object.keys(ADAPTERS) as AdapterKind[]).map(async (k) => {
      if (k === "node") {
        if (getFeature("debug.jsDebugPath")) out.add(k);
        return;
      }
      if (k === "go" && getFeature("debug.dlvPath")) return void out.add(k);
      for (const c of ADAPTERS[k].commands) if (await detect(c)) return void out.add(k);
    }),
  );
  return out;
}

async function openTransport(cfg: ResolvedConfig): Promise<{ transport: Awaited<ReturnType<typeof stdioAdapter>>; port: number | null }> {
  const spec = ADAPTERS[cfg.adapter];
  if (cfg.adapter === "python") {
    const py = await pythonFor(cfg.cwd);
    if (!py) throw new Error(`Python not found. ${spec.install}`);
    const probe = await native.runCommand(`${callExe(py)} -c "import debugpy"`, cfg.cwd, 20).catch(() => null);
    if (probe && probe.exit_code !== 0) throw new Error(`debugpy isn't installed for ${py}. Run: ${py} -m pip install debugpy`);
    if (cfg.args.python === undefined) cfg.args.python = py;
    return { transport: await stdioAdapter(py, spec.args, cfg.cwd), port: null };
  }
  if (cfg.adapter === "node") {
    const js = getFeature("debug.jsDebugPath");
    if (!js) throw new Error(`Node debugging needs js-debug. ${spec.install}`);
    const port = await freePort();
    return { transport: await tcpAdapter("node", [js, "{port}", "127.0.0.1"], cfg.cwd, port), port };
  }
  let command: string | null = null;
  if (cfg.adapter === "go") command = getFeature("debug.dlvPath") || null;
  if (!command) for (const c of spec.commands) if (await detect(c)) {
    command = c;
    break;
  }
  if (!command && cfg.adapter === "go") {
    const home = (await native.runCommand(IS_WINDOWS ? "echo %USERPROFILE%" : "echo $HOME", null, 5).catch(() => null))?.stdout.trim();
    const guess = home ? `${home}/go/bin/dlv${IS_WINDOWS ? ".exe" : ""}` : null;
    if (guess && (await exists(guess))) command = guess;
  }
  if (!command) throw new Error(`${spec.label} isn't installed. ${spec.install}`);
  if (spec.transport === "stdio") return { transport: await stdioAdapter(command, spec.args, cfg.cwd), port: null };
  const port = await freePort();
  return { transport: await tcpAdapter(command, spec.args, cfg.cwd, port), port };
}

function runInTerminal(args: { cwd: string; args: string[]; env?: Record<string, string | null>; title?: string }): Promise<{ processId?: number }> {
  const env = Object.entries(args.env ?? {}).filter(([, v]) => v !== null) as [string, string][];
  const [exe, ...rest] = args.args;
  const cmd = [callExe(exe), ...rest.map((a) => quoteShellArg(a))].join(" ");
  const prefix = IS_WINDOWS ? env.map(([k, v]) => `$env:${k}=${quoteShellArg(v)}; `).join("") : env.length ? `env ${env.map(([k, v]) => `${k}=${quoteShellArg(v)}`).join(" ")} ` : "";
  app().openTerminal({ cwd: args.cwd, command: `${prefix}${cmd}` });
  return Promise.resolve({});
}

async function launchSession(cfg: ResolvedConfig, transport: Awaited<ReturnType<typeof stdioAdapter>>, parentId: number | null, port: number | null): Promise<void> {
  const id = ++sessionId;
  const client = new DapClient(transport);
  const session: DebugSession = new DebugSession(
    client,
    { name: cfg.name, adapterId: ADAPTERS[cfg.adapter].adapterId, request: cfg.request, args: cfg.args },
    {
      breakpoints: breakpointMap,
      exceptionFilters: () => useDebugStore.getState().exceptionFilters,
      onState: (state) => {
        patchEntry(id, { state });
        if (state.status === "stopped") {
          useDebugStore.setState({ activeId: id, selectedFrameId: state.frames[0]?.id ?? null });
          revealFrame(state.frames.find((f) => f.path) ?? null);
          void evaluateWatches();
        }
        if (state.status === "ended") onEnded(id);
      },
      onOutput: (category, text) => logConsole(category, text),
      runInTerminal,
      startChild:
        port !== null
          ? async (configuration, request) => {
              const child = await tcpAdapter("", [], cfg.cwd, port);
              await launchSession({ ...cfg, name: String(configuration.name ?? `${cfg.name} (child)`), request, args: configuration }, child, id, port);
            }
          : undefined,
    },
  );
  useDebugStore.setState((s) => ({ sessions: [...s.sessions, { id, name: cfg.name, session, state: session.state, parentId, config: cfg }], activeId: s.activeId ?? id }));
  await session.start();
}

function onEnded(id: number): void {
  setTimeout(() => {
    useDebugStore.setState((s) => {
      const sessions = s.sessions.filter((e) => e.id !== id && e.parentId !== id);
      return { sessions, activeId: s.activeId === id ? (sessions[0]?.id ?? null) : s.activeId, selectedFrameId: s.activeId === id ? null : s.selectedFrameId };
    });
  }, 400);
  const e = useDebugStore.getState().sessions.find((x) => x.id === id);
  if (e && !e.parentId) logConsole("console", `\n— ${e.name} ended${e.state.exitCode !== null ? ` (exit code ${e.state.exitCode})` : ""} —\n`);
}

/** Start debugging a resolved configuration. */
export async function startDebugging(cfg: ResolvedConfig): Promise<void> {
  if (useDebugStore.getState().starting) return;
  useDebugStore.setState({ starting: true, lastConfig: cfg });
  window.dispatchEvent(new CustomEvent("gear:show-debug-panel"));
  logConsole("console", `▶ ${cfg.name}\n`);
  try {
    if (cfg.preLaunch) {
      logConsole("console", `$ ${cfg.preLaunch}\n`);
      const r = await native.runCommand(cfg.preLaunch, cfg.cwd, 600);
      logConsole("stdout", r.stdout);
      logConsole("stderr", r.stderr);
      if (r.exit_code !== 0) throw new Error(`"${cfg.preLaunch}" failed (exit ${r.exit_code})`);
    }
    const { transport, port } = await openTransport(cfg);
    await launchSession(cfg, transport, null, port);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logConsole("stderr", `${msg}\n`);
    toast.error("Couldn't start debugging", { description: msg.slice(0, 400) });
  } finally {
    useDebugStore.setState({ starting: false });
  }
}

/** Launch configurations for the workspace: .vscode/launch.json plus a default for the active file. */
export async function configurations(): Promise<{ label: string; description: string; config: LaunchConfig }[]> {
  const root = app().workspaceRoot()?.replace(/[\\/]+$/, "");
  const file = getActiveEditor()?.path;
  const out: { label: string; description: string; config: LaunchConfig }[] = [];
  if (root) {
    const r = await native.readFile(`${root}/.vscode/launch.json`).catch(() => null);
    if (r?.kind === "text") {
      try {
        for (const c of parseLaunchJson(r.content)) out.push({ label: c.name, description: `launch.json · ${c.type}`, config: c });
      } catch (e) {
        toast.error("Couldn't read .vscode/launch.json", { description: String(e) });
      }
    }
  }
  if (file) {
    let cargoBinary: string | undefined;
    if (/\.rs$/.test(file) && root) {
      const toml = await native.readFile(`${root}/Cargo.toml`).catch(() => null);
      const name = toml?.kind === "text" ? cargoBinaryName(toml.content) : null;
      if (name) cargoBinary = `${root}/target/debug/${name}${IS_WINDOWS ? ".exe" : ""}`;
    }
    const d = defaultConfigFor(file, { cargoBinary });
    if (d && !out.some((o) => o.config.type === d.type && o.config.program === d.program)) out.push({ label: d.name, description: file.replace(/^.*[\\/]/, ""), config: d });
  }
  return out;
}

export async function resolveForWorkspace(c: LaunchConfig): Promise<ResolvedConfig> {
  const root = app().workspaceRoot()?.replace(/[\\/]+$/, "") ?? getActiveEditor()?.path?.replace(/[\\/][^\\/]*$/, "") ?? ".";
  const avail = await availableAdapters();
  return resolveConfig(c, { workspaceFolder: root, file: getActiveEditor()?.path, pathSep: IS_WINDOWS ? "\\" : "/" }, (k) => avail.has(k));
}

/** F5: continue if paused, else start (asking for a configuration when there's more than one). */
export async function startOrContinue(): Promise<void> {
  const e = activeEntry();
  if (e && e.state.status === "stopped") return void e.session.continue().catch(report);
  if (e && e.state.status !== "ended") return;
  const cfgs = await configurations();
  if (!cfgs.length) return void toast.info("Nothing to debug here", { description: "Open a Python, JavaScript/TypeScript, Go, Rust or C file, or add .vscode/launch.json (Debug: Open launch.json)." });
  const pick = cfgs.length === 1 ? cfgs[0].config : await quickPick(cfgs.map((c) => ({ label: c.label, description: c.description, value: c.config })), { title: "Start debugging" });
  if (!pick) return;
  try {
    await startDebugging(await resolveForWorkspace(pick));
  } catch (err) {
    report(err);
  }
}

export async function restartDebugging(): Promise<void> {
  const last = useDebugStore.getState().lastConfig;
  await stopDebugging();
  if (last) setTimeout(() => void startDebugging(last), 500);
}

export async function stopDebugging(): Promise<void> {
  const sessions = useDebugStore.getState().sessions.filter((e) => e.state.status !== "ended");
  await Promise.all(sessions.map((e) => e.session.stop().catch(() => {})));
}

function report(e: unknown): void {
  toast.error(e instanceof Error ? e.message : String(e));
}

/** The session commands for the toolbar and shortcuts. */
export const debugCommand = {
  continue: () => activeEntry()?.session.continue().catch(report),
  pause: () => activeEntry()?.session.pause().catch(report),
  next: () => activeEntry()?.session.next().catch(report),
  stepIn: () => activeEntry()?.session.stepIn().catch(report),
  stepOut: () => activeEntry()?.session.stepOut().catch(report),
};

// ── frames & watches ──────────────────────────────────────────────────────

export function revealFrame(frame: StackFrame | null): void {
  if (!frame?.path) return;
  app().openFile(frame.path, frame.line);
}

export function selectFrame(frame: StackFrame): void {
  useDebugStore.setState({ selectedFrameId: frame.id });
  revealFrame(frame);
  void evaluateWatches();
}

export const useWatchResults = create<{ results: Record<string, { value: string; error?: boolean; ref: number }> }>(() => ({ results: {} }));

export async function evaluateWatches(): Promise<void> {
  const e = activeEntry();
  const { watches, selectedFrameId } = useDebugStore.getState();
  if (!e || e.state.status !== "stopped") return;
  const results: Record<string, { value: string; error?: boolean; ref: number }> = {};
  for (const w of watches) {
    try {
      const r = await e.session.evaluate(w, selectedFrameId, "watch");
      results[w] = { value: r.result, ref: r.variablesReference };
    } catch (err) {
      results[w] = { value: err instanceof Error ? err.message : String(err), error: true, ref: 0 };
    }
  }
  useWatchResults.setState({ results });
}

/** Evaluate in the debug console (REPL). */
export async function replEvaluate(expression: string): Promise<void> {
  const e = activeEntry();
  logConsole("input", `> ${expression}\n`);
  if (!e || e.state.status === "ended") return logConsole("stderr", "No debug session\n");
  try {
    const r = await e.session.evaluate(expression, useDebugStore.getState().selectedFrameId, "repl");
    logConsole("result", `${r.result}\n`);
  } catch (err) {
    logConsole("stderr", `${err instanceof Error ? err.message : err}\n`);
  }
}

/** Run to the cursor: a one-shot breakpoint, then continue. */
export async function runToLine(path: string, line: number): Promise<void> {
  const e = activeEntry();
  if (!e || e.state.status !== "stopped") return void toast.info("Pause at a breakpoint first");
  const had = breakpointsIn(path).some((b) => b.line === line);
  if (!had) upsertBreakpoint(path, { line, enabled: true });
  await e.session.continue().catch(report);
  if (had) return;
  const off = useDebugStore.subscribe((s) => {
    const cur = s.sessions.find((x) => x.id === e.id);
    if (!cur || cur.state.status !== "running") {
      off();
      removeBreakpoint(path, line);
    }
  });
}
