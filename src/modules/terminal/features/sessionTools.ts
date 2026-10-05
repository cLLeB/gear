// Terminal session tools: a per-pane command log, running editor text in a
// terminal, SSH / Docker / listening-port pickers and asciinema recording.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { homeDir } from "@tauri-apps/api/path";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { IS_MAC, IS_WINDOWS } from "@/lib/platform";
import { quoteShellArg } from "@/lib/shellQuote";
import { native } from "@/modules/ai/lib/native";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { confirmPick, quickPick } from "@/modules/quick-pick";
import { onTerminalOutputBytes } from "../lib/outputTap";
import { writeTerminalClipboard } from "../lib/terminalClipboard";
import { leafIds } from "../lib/panes";
import {
  isLeafCommandRunning,
  lastFinishedCommand,
  leafCommandOutput,
  leafCwd,
  leafTerminal,
  listLeafCommands,
  scrollLeafToLine,
} from "../lib/useTerminalSession";
import { guardedSubmit } from "./guardedSubmit";
import { formatDurationShort, useLastCommandStore } from "./lastCommandStore";
import {
  AsciicastRecorder,
  parseDockerPs,
  parseLsof,
  parseNetstat,
  parseSs,
  parseSshConfig,
  sshIncludes,
  type Container,
  type ListeningPort,
} from "./devTools";

// The terminal the user was last in, so editor-side commands have a target.
let lastTerminalLeaf: number | null = null;
useLastCommandStore.subscribe((s) => {
  if (s.activeLeaf !== null) lastTerminalLeaf = s.activeLeaf;
});

export function targetLeaf(): number | null {
  const active = app().activeTerminalLeaf();
  if (active !== null) return active;
  return lastTerminalLeaf !== null && leafTerminal(lastTerminalLeaf) ? lastTerminalLeaf : null;
}

function tabOfLeaf(leafId: number): number | null {
  for (const t of app().tabs()) {
    if (t.kind === "terminal" && leafIds(t.paneTree).includes(leafId)) return t.id;
  }
  return null;
}

async function copy(text: string, what: string): Promise<void> {
  await writeTerminalClipboard(text);
  toast.success(`Copied ${what}`);
}

// ── command log ───────────────────────────────────────────────────────────

export async function commandLog(): Promise<void> {
  const leaf = app().activeTerminalLeaf();
  if (leaf === null) {
    toast.error("Focus a terminal first");
    return;
  }
  const cmds = listLeafCommands(leaf).reverse();
  const now = Date.now();
  const pick = await quickPick(
    cmds.map((c) => {
      const status = c.exitCode === null ? (c.finishedAt ? "?" : "…") : c.exitCode === 0 ? "✓" : `✗ ${c.exitCode}`;
      const dur = c.startedAt !== null && c.finishedAt !== null ? formatDurationShort(c.finishedAt - c.startedAt) : "running";
      const ago = c.finishedAt ? `${formatDurationShort(now - c.finishedAt)} ago` : "";
      return { label: `${status}  ${c.command}`, description: [dur, ago].filter(Boolean).join(" · "), value: c };
    }),
    { title: "Commands in this pane", emptyText: "No commands yet (needs shell integration)", placeholder: "Search commands…" },
  );
  if (!pick) return;
  const action = await quickPick(
    [
      ...(pick.line >= 0 ? [{ label: "Scroll to it", value: "scroll" as const }] : []),
      { label: "Run again", value: "rerun" as const },
      { label: "Copy command", value: "copy" as const },
      ...(pick.line >= 0 ? [{ label: "Copy its output", value: "output" as const }] : []),
    ],
    { title: pick.command },
  );
  if (action === "scroll") scrollLeafToLine(leaf, pick.line);
  else if (action === "copy") await copy(pick.command, "command");
  else if (action === "output") {
    const out = leafCommandOutput(leaf, pick.index);
    if (out) await copy(out, "output");
    else toast.info("That output is no longer in the scrollback");
  } else if (action === "rerun") {
    if (isLeafCommandRunning(leaf)) toast.error("A command is still running in this pane");
    else await guardedSubmit(leaf, pick.command);
  }
}

// ── run editor text in a terminal ─────────────────────────────────────────

export async function runSelectionInTerminal(): Promise<void> {
  const ed = getActiveEditor();
  if (!ed) {
    toast.error("Open a file in the editor first");
    return;
  }
  const { state } = ed.view;
  const sel = state.selection.main;
  const text = (sel.empty ? state.doc.lineAt(sel.head).text : state.sliceDoc(sel.from, sel.to)).replace(/\s+$/, "");
  if (!text.trim()) {
    toast.info("Nothing to run on this line");
    return;
  }
  const leaf = targetLeaf();
  if (leaf === null) {
    const dir = ed.path ? ed.path.replace(/[\\/][^\\/]*$/, "") : null;
    app().openTerminal({ cwd: dir, command: text });
    return;
  }
  if (isLeafCommandRunning(leaf)) {
    if (!(await confirmPick("A command is running in that terminal", "Type it into the running program"))) return;
  }
  if (!(await guardedSubmit(leaf, text))) return;
  // Move the editor cursor to the next line so repeated runs step through a script.
  if (sel.empty) {
    const next = state.doc.lineAt(sel.head).number + 1;
    if (next <= state.doc.lines) ed.view.dispatch({ selection: { anchor: state.doc.line(next).from }, scrollIntoView: true });
  }
  const tab = tabOfLeaf(leaf);
  toast.success("Sent to terminal", {
    description: text.length > 80 ? `${text.slice(0, 80)}…` : text,
    action: tab !== null ? { label: "Show", onClick: () => app().activateTab(tab) } : undefined,
  });
}

// ── SSH ───────────────────────────────────────────────────────────────────

async function readText(path: string): Promise<string> {
  const r = await native.readFile(path).catch(() => null);
  return r?.kind === "text" ? r.content : "";
}

export async function sshConnect(): Promise<void> {
  const home = (await homeDir().catch(() => "")).replace(/[\\/]+$/, "");
  const sshDir = `${home}/.ssh`;
  const main = await readText(`${sshDir}/config`);
  const included = await Promise.all(sshIncludes(main, sshDir).map(readText));
  const hosts = [main, ...included].flatMap(parseSshConfig);
  const choice = await quickPick(
    hosts.map((h) => ({
      label: h.alias,
      description: [h.user ? `${h.user}@` : "", h.hostName ?? "", h.port ? `:${h.port}` : ""].join("") || undefined,
      value: h.alias,
    })),
    { title: "SSH to host", emptyText: `No hosts in ${sshDir}/config`, placeholder: "Pick a host from ~/.ssh/config" },
  );
  if (!choice) return;
  app().openTerminal({ command: `ssh ${quoteShellArg(choice)}` });
}

// ── Docker ────────────────────────────────────────────────────────────────

export async function dockerContainers(): Promise<void> {
  const r = await native.runCommand('docker ps -a --format "{{json .}}"', app().workspaceRoot(), 15).catch((e) => ({ exit_code: 1, stdout: "", stderr: String(e) }));
  if (r.exit_code !== 0) {
    toast.error("Docker is not available", { description: (r.stderr || "Is the Docker daemon running?").trim().slice(0, 300) });
    return;
  }
  const container = await quickPick(
    parseDockerPs(r.stdout).map((c) => ({
      label: `${c.state === "running" ? "●" : "○"} ${c.name}`,
      description: `${c.image} · ${c.status}`,
      detail: c.ports || undefined,
      keywords: [c.id, c.image],
      value: c,
    })),
    { title: "Docker containers", emptyText: "No containers" },
  );
  if (!container) return;
  await containerAction(container);
}

async function containerAction(c: Container): Promise<void> {
  const running = c.state === "running";
  const action = await quickPick(
    [
      ...(running ? [{ label: "Open a shell", value: "shell" as const }] : []),
      { label: "Follow logs", value: "logs" as const },
      ...(running
        ? [
            { label: "Restart", value: "restart" as const },
            { label: "Stop", value: "stop" as const },
            { label: "Live stats", value: "stats" as const },
          ]
        : [{ label: "Start", value: "start" as const }]),
      { label: "Inspect (JSON)", value: "inspect" as const },
      { label: "Remove", value: "rm" as const },
    ],
    { title: `${c.name} (${c.image})` },
  );
  if (!action) return;
  const id = c.id;
  switch (action) {
    case "shell":
      app().openTerminal({ command: `docker exec -it ${id} sh -c "command -v bash >/dev/null && exec bash || exec sh"` });
      return;
    case "logs":
      app().openTerminal({ command: `docker logs -f --tail 300 ${id}` });
      return;
    case "stats":
      app().openTerminal({ command: `docker stats ${id}` });
      return;
    case "inspect":
      app().openTerminal({ command: `docker inspect ${id}` });
      return;
    case "rm":
      if (!(await confirmPick(`Remove container ${c.name}?`, running ? "Stop and remove" : "Remove"))) return;
  }
  const cmd = action === "rm" ? `docker rm -f ${id}` : `docker ${action} ${id}`;
  const t = toast.loading(`${action} ${c.name}…`);
  const r = await native.runCommand(cmd, null, 60).catch((e) => ({ exit_code: 1, stdout: "", stderr: String(e) }));
  toast.dismiss(t);
  if (r.exit_code === 0) toast.success(`${c.name}: ${action === "rm" ? "removed" : `${action} done`}`);
  else toast.error(`docker ${action} failed`, { description: r.stderr.trim().slice(0, 300) });
}

// ── listening ports ───────────────────────────────────────────────────────

async function listPorts(): Promise<ListeningPort[]> {
  const run = (cmd: string) => native.runCommand(cmd, null, 15).catch(() => ({ exit_code: 1, stdout: "", stderr: "" }));
  if (IS_WINDOWS) {
    const [net, tasks] = await Promise.all([run("netstat -ano -p tcp"), run("tasklist /fo csv /nh")]);
    return parseNetstat(net.stdout, tasks.stdout);
  }
  if (!IS_MAC) {
    const ss = await run("ss -ltnpH");
    if (ss.exit_code === 0 && ss.stdout.trim()) return parseSs(ss.stdout);
  }
  return parseLsof((await run("lsof -nP -iTCP -sTCP:LISTEN")).stdout);
}

export async function listeningPorts(): Promise<void> {
  const port = await quickPick(
    listPorts().then((ports) =>
      ports.map((p) => ({
        label: `:${p.port}`,
        description: [p.process, p.pid ? `pid ${p.pid}` : null, p.address].filter(Boolean).join(" · "),
        keywords: [String(p.port), p.process ?? ""],
        value: p,
      })),
    ),
    { title: "Listening TCP ports", emptyText: "Nothing is listening (or the list needs more permissions)" },
  );
  if (!port) return;
  const url = `http://localhost:${port.port}`;
  const action = await quickPick(
    [
      { label: "Open in preview", description: url, value: "preview" as const },
      { label: "Copy URL", value: "copy" as const },
      ...(port.pid ? [{ label: `Kill ${port.process ?? "process"} (pid ${port.pid})`, value: "kill" as const }] : []),
    ],
    { title: `Port ${port.port}` },
  );
  if (action === "preview") app().openPreview(url);
  else if (action === "copy") await copy(url, "URL");
  else if (action === "kill" && port.pid) {
    if (!(await confirmPick(`Kill ${port.process ?? "the process"} (pid ${port.pid})?`, "Kill process", `It is listening on port ${port.port}.`))) return;
    const r = await native.runCommand(IS_WINDOWS ? `taskkill /PID ${port.pid} /F` : `kill ${port.pid}`, null, 10);
    if (r.exit_code === 0) toast.success(`Killed pid ${port.pid}`);
    else toast.error("Kill failed", { description: (r.stderr || r.stdout).trim().slice(0, 300) });
  }
}

// ── asciinema recording ───────────────────────────────────────────────────

const MAX_RECORDING_EVENTS = 500_000;
const recordings = new Map<number, { recorder: AsciicastRecorder; dispose: () => void; cwd: string | null }>();

export function isRecording(leafId: number): boolean {
  return recordings.has(leafId);
}

export async function toggleRecording(): Promise<void> {
  const leaf = app().activeTerminalLeaf();
  if (leaf === null) {
    toast.error("Focus a terminal first");
    return;
  }
  const existing = recordings.get(leaf);
  if (existing) {
    existing.dispose();
    recordings.delete(leaf);
    await saveRecording(existing.recorder, existing.cwd ?? app().workspaceRoot());
    return;
  }
  const term = leafTerminal(leaf);
  if (!term) {
    toast.error("This terminal is not on screen");
    return;
  }
  const recorder = new AsciicastRecorder(term.cols, term.rows, Date.now(), "Gear terminal session");
  const offOutput = onTerminalOutputBytes((id, bytes) => {
    if (id !== leaf) return;
    recorder.output(bytes, Date.now());
    if (recorder.eventCount > MAX_RECORDING_EVENTS) void toggleRecording();
  });
  const offResize = term.onResize(({ cols, rows }) => recorder.resize(cols, rows, Date.now()));
  recordings.set(leaf, {
    recorder,
    cwd: leafCwd(leaf),
    dispose: () => {
      offOutput();
      offResize.dispose();
    },
  });
  toast.success("Recording this pane", { description: "Run “Terminal: Start / stop recording” again to save the .cast file." });
}

async function saveRecording(recorder: AsciicastRecorder, dir: string | null): Promise<void> {
  if (!dir) {
    toast.error("No directory to save the recording into");
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  try {
    const path = await invoke<string>("fs_write_new", {
      destDir: dir,
      name: `gear-recording-${stamp}.cast`,
      content: Array.from(new TextEncoder().encode(recorder.toString())),
      workspace: currentWorkspaceEnv(),
    });
    toast.success("Recording saved", {
      description: `${path} — play with: asciinema play <file>`,
      action: { label: "Copy play command", onClick: () => void writeTerminalClipboard(`asciinema play ${quoteShellArg(path)}`) },
    });
  } catch (e) {
    toast.error("Could not save the recording", { description: String(e) });
  }
}

// ── re-run on save ────────────────────────────────────────────────────────

const watchers = new Map<number, () => void>();

/** Toggle: re-run the pane's last command whenever a file is saved in Gear. */
export async function toggleRerunOnSave(): Promise<void> {
  const leaf = app().activeTerminalLeaf();
  if (leaf === null) {
    toast.error("Focus a terminal first");
    return;
  }
  const existing = watchers.get(leaf);
  if (existing) {
    existing();
    watchers.delete(leaf);
    toast.info("Stopped re-running on save");
    return;
  }
  const last = lastFinishedCommand(leaf);
  if (!last?.command) {
    toast.error("Run the command once first", { description: "Gear re-runs the pane's last command (needs shell integration)." });
    return;
  }
  const command = last.command;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unlisten = await listen<{ path: string }>("fs:file-written", (e) => {
    // Skip files the command itself is likely to write (build output, logs).
    if (/[\\/](node_modules|target|dist|build|\.git)[\\/]|\.log$/.test(e.payload.path)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (!leafTerminal(leaf)) return;
      if (isLeafCommandRunning(leaf)) return; // still busy with the previous run
      void guardedSubmit(leaf, command);
    }, 300);
  });
  watchers.set(leaf, () => {
    if (timer) clearTimeout(timer);
    unlisten();
  });
  toast.success("Re-running on save", { description: `${command} — run this command again to stop` });
}

// ── environment ───────────────────────────────────────────────────────────

const SECRET_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE|CREDENTIAL|AUTH)/i;

export function parseEnvOutput(out: string): [string, string][] {
  const vars: [string, string][] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w().]*)=(.*)$/.exec(line);
    if (m) vars.push([m[1], m[2]]);
  }
  return vars.sort((a, b) => a[0].localeCompare(b[0]));
}

export async function showEnvironment(): Promise<void> {
  const cwd = app().activeCwd();
  const r = await native.runCommand(IS_WINDOWS ? "set" : "env", cwd, 10).catch(() => null);
  if (!r || r.exit_code !== 0) {
    toast.error("Could not read the environment");
    return;
  }
  const pick = await quickPick(
    parseEnvOutput(r.stdout).map(([k, v]) => {
      const secret = SECRET_NAME.test(k);
      const shown = secret ? `${"•".repeat(Math.min(12, v.length))} (hidden)` : k === "PATH" || k === "Path" ? v.split(IS_WINDOWS ? ";" : ":").slice(0, 4).join(IS_WINDOWS ? ";" : ":") + "…" : v;
      return { label: k, description: shown.slice(0, 120), keywords: secret ? [k] : [k, v], value: [k, v] as const };
    }),
    { title: "Environment variables (as Gear's shells start)", placeholder: "Pick one to copy its value" },
  );
  if (!pick) return;
  const [k, v] = pick;
  if (k === "PATH" || k === "Path") {
    const entry = await quickPick(
      v.split(IS_WINDOWS ? ";" : ":").filter(Boolean).map((p, i) => ({ label: p, description: `#${i + 1}`, value: p })),
      { title: "PATH entries", placeholder: "Pick one to copy it" },
    );
    if (entry) await copy(entry, "path entry");
    return;
  }
  await copy(v, k);
}
