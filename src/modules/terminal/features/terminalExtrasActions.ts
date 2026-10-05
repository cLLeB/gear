// Terminal extras: search every terminal's output, filter/mark scrollback,
// share a command as Markdown, activate the project toolchain, Kubernetes and
// process pickers, scheduled commands, rotating panes, send-to-all.

import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { IS_WINDOWS } from "@/lib/platform";
import { quoteShellArg } from "@/lib/shellQuote";
import { native } from "@/modules/ai/lib/native";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { confirmPick, inputBox, quickPick } from "@/modules/quick-pick";
import { leafIds } from "../lib/panes";
import { onTerminalOutputLines } from "../lib/outputTap";
import { writeTerminalClipboard } from "../lib/terminalClipboard";
import { isLeafCommandRunning, lastFinishedCommand, leafCwd, leafTerminal, submitToLeaf } from "../lib/useTerminalSession";
import { classifyCommand } from "./commandGuard";
import { guardedSubmit } from "./guardedSubmit";
import {
  activationCommands,
  commandAsMarkdown,
  OutputRing,
  parseKubeContexts,
  parsePods,
  parsePs,
  parseSchedule,
  parseTasklist,
  rotatePanes,
  searchRegex,
} from "./terminalExtras";

// ── output history for every pane ─────────────────────────────────────────

const rings = new Map<number, OutputRing>();
onTerminalOutputLines((leafId, lines) => {
  let r = rings.get(leafId);
  if (!r) rings.set(leafId, (r = new OutputRing()));
  r.push(lines);
});

function terminalTabs() {
  return app().tabs().filter((t) => t.kind === "terminal");
}

function tabTitle(t: ReturnType<typeof terminalTabs>[number]): string {
  return ("customTitle" in t && t.customTitle) || t.title || "terminal";
}

/** Scroll a bound pane to the last buffer line containing `text`. */
function scrollToText(leafId: number, text: string): boolean {
  const term = leafTerminal(leafId);
  if (!term) return false;
  const buf = term.buffer.active;
  const needle = text.trim().slice(0, 60);
  for (let y = buf.length - 1; y >= 0; y--) {
    if (buf.getLine(y)?.translateToString(true).includes(needle)) {
      term.scrollToLine(Math.max(0, y - Math.floor(term.rows / 2)));
      term.select(0, y, term.cols);
      return true;
    }
  }
  return false;
}

export async function findInAllTerminals(): Promise<void> {
  const q = await inputBox({ title: "Find in all terminals", placeholder: "text, or /regex/ — searches recent output of every pane, including hidden tabs" });
  if (!q) return;
  let re: RegExp;
  try {
    re = searchRegex(q);
  } catch (e) {
    toast.error("Invalid regular expression", { description: String(e) });
    return;
  }
  const hits: { leaf: number; tab: number; title: string; text: string }[] = [];
  for (const t of terminalTabs()) {
    if (t.kind !== "terminal") continue;
    for (const leaf of leafIds(t.paneTree)) {
      for (const h of rings.get(leaf)?.search(re, 100) ?? []) hits.push({ leaf, tab: t.id, title: tabTitle(t), text: h.text });
    }
  }
  const pick = await quickPick(
    hits.map((h) => ({ label: h.text.trim().slice(0, 160), description: h.title, value: h })),
    { title: `“${q}” in ${terminalTabs().length} terminal tab(s)`, emptyText: "No matches in recent output" },
  );
  if (!pick) return;
  app().activateTab(pick.tab);
  setTimeout(() => scrollToText(pick.leaf, pick.text), 150);
}

/** Wrapped buffer rows joined back into logical lines, with their first row. */
function logicalLines(leafId: number): { row: number; text: string }[] {
  const term = leafTerminal(leafId);
  if (!term) return [];
  const buf = term.buffer.active;
  const out: { row: number; text: string }[] = [];
  for (let y = 0; y < buf.length; y++) {
    const line = buf.getLine(y);
    if (!line) continue;
    const text = line.translateToString(true);
    if (line.isWrapped && out.length) out[out.length - 1].text += text;
    else out.push({ row: y, text });
  }
  return out;
}

export async function filterScrollback(): Promise<void> {
  const leaf = app().activeTerminalLeaf();
  if (leaf === null) return void toast.error("Focus a terminal first");
  const q = await inputBox({ title: "Filter this pane's scrollback", placeholder: "text or /regex/ (like grep on everything above)" });
  if (!q) return;
  let re: RegExp;
  try {
    re = searchRegex(q);
  } catch (e) {
    return void toast.error("Invalid regular expression", { description: String(e) });
  }
  const lines = logicalLines(leaf).filter((l) => re.test(l.text));
  const pick = await quickPick(
    [
      ...(lines.length ? [{ label: `Copy all ${lines.length} matching lines`, value: -1 }] : []),
      ...lines.reverse().map((l) => ({ label: l.text.trim().slice(0, 200), description: `row ${l.row + 1}`, value: l.row })),
    ],
    { title: `${lines.length} matching line${lines.length === 1 ? "" : "s"}`, emptyText: "No matching lines" },
  );
  if (pick === undefined) return;
  if (pick === -1) {
    await writeTerminalClipboard(lines.reverse().map((l) => l.text).join("\n"));
    return void toast.success("Copied matching lines");
  }
  const term = leafTerminal(leaf);
  term?.scrollToLine(Math.max(0, pick - 3));
  term?.selectLines(pick, pick);
}

// ── marks ─────────────────────────────────────────────────────────────────

const marks = new Map<number, { label: string; marker: { line: number; isDisposed: boolean } }[]>();

export async function markLine(): Promise<void> {
  const leaf = app().activeTerminalLeaf();
  const term = leaf !== null ? leafTerminal(leaf) : null;
  if (leaf === null || !term) return void toast.error("Focus a terminal first");
  const label = await inputBox({ title: "Mark this point in the scrollback", value: new Date().toLocaleTimeString() });
  if (label === undefined) return;
  const marker = term.registerMarker(0);
  if (!marker) return;
  const list = marks.get(leaf) ?? [];
  list.push({ label: label || "mark", marker });
  marks.set(leaf, list);
  term.registerDecoration({ marker, overviewRulerOptions: { color: "#f59e0b" } });
  toast.success("Marked", { description: "Jump back with “Terminal: Go to mark…”" });
}

export async function goToMark(): Promise<void> {
  const leaf = app().activeTerminalLeaf();
  if (leaf === null) return void toast.error("Focus a terminal first");
  const list = (marks.get(leaf) ?? []).filter((m) => !m.marker.isDisposed);
  const pick = await quickPick(list.map((m) => ({ label: m.label, description: `row ${m.marker.line + 1}`, value: m.marker.line })).reverse(), {
    title: "Marks in this pane",
    emptyText: "No marks yet — use “Terminal: Mark current line”",
  });
  if (pick !== undefined) leafTerminal(leaf)?.scrollToLine(Math.max(0, pick - 2));
}

// ── sharing / toolchain ───────────────────────────────────────────────────

export async function copyCommandAsMarkdown(): Promise<void> {
  const leaf = app().activeTerminalLeaf();
  const last = leaf !== null ? lastFinishedCommand(leaf) : null;
  if (!last) return void toast.error("No finished command yet (needs shell integration)");
  await writeTerminalClipboard(commandAsMarkdown(last.command, last.output ?? "", last.exitCode, last.cwd));
  toast.success("Copied command and output as Markdown", { description: "Ready for an issue, PR or chat." });
}

export async function activateToolchain(): Promise<void> {
  const leaf = app().activeTerminalLeaf();
  if (leaf === null) return void toast.error("Focus a terminal first");
  const cwd = leafCwd(leaf) ?? app().activeCwd();
  if (!cwd) return;
  const entries = await native.readDir(cwd).catch(() => []);
  const names = new Set(entries.map((e) => e.name));
  const venvDirs: string[] = [];
  for (const d of [".venv", "venv", "env", ".env"].filter((n) => entries.some((e) => e.name === n && e.kind === "dir"))) {
    const cfg = await native.readFile(`${cwd}/${d}/pyvenv.cfg`).catch(() => null);
    if (cfg) venvDirs.push(d);
  }
  const shell = IS_WINDOWS ? "powershell" : "posix";
  const cmds = activationCommands({ venvDirs, hasNvmrc: names.has(".nvmrc"), hasNodeVersion: names.has(".node-version"), hasToolVersions: names.has(".tool-versions") }, shell);
  if (!cmds.length) return void toast.info("No virtualenv, .nvmrc, .node-version or .tool-versions here", { description: cwd });
  for (const c of cmds) submitToLeaf(leaf, c);
  toast.success("Activated project toolchain", { description: cmds.join(" ; ") });
}

export function newTerminalAtFile(): void {
  const path = getActiveEditor()?.path;
  if (!path) return void toast.error("Open a file in the editor first");
  app().openTerminal({ cwd: path.replace(/[\\/][^\\/]*$/, "") });
}

// ── Kubernetes ────────────────────────────────────────────────────────────

async function kubectl(args: string): Promise<string | null> {
  const r = await native.runCommand(`kubectl ${args}`, null, 20).catch((e) => ({ exit_code: 1, stdout: "", stderr: String(e) }));
  if (r.exit_code !== 0) {
    toast.error("kubectl failed", { description: (r.stderr || "Is kubectl installed and configured?").trim().slice(0, 300) });
    return null;
  }
  return r.stdout;
}

export async function kubernetes(): Promise<void> {
  const out = await kubectl("config get-contexts");
  if (out === null) return;
  const ctxs = parseKubeContexts(out);
  const ctx = await quickPick(
    ctxs.map((c) => ({ label: `${c.current ? "● " : ""}${c.name}`, description: `${c.cluster} · ns ${c.namespace}`, value: c })),
    { title: "Kubernetes context", placeholder: "Pick a context (switches to it)" },
  );
  if (!ctx) return;
  if (!ctx.current && (await kubectl(`config use-context ${quoteShellArg(ctx.name)}`)) === null) return;
  const podsOut = await kubectl(`get pods -n ${quoteShellArg(ctx.namespace)} --no-headers`);
  if (podsOut === null) return;
  const pod = await quickPick(
    parsePods(podsOut).map((p) => ({ label: `${p.status === "Running" ? "●" : "○"} ${p.name}`, description: `${p.status} · ready ${p.ready} · restarts ${p.restarts} · ${p.age}`, value: p })),
    { title: `Pods in ${ctx.namespace} (${ctx.name})`, emptyText: "No pods in this namespace" },
  );
  if (!pod) return;
  const ns = `-n ${quoteShellArg(ctx.namespace)} ${quoteShellArg(pod.name)}`;
  const action = await quickPick(
    [
      { label: "Follow logs", value: `kubectl logs -f --tail=300 ${ns}` },
      { label: "Open a shell", value: `kubectl exec -it ${ns} -- sh -c "command -v bash >/dev/null && exec bash || exec sh"` },
      { label: "Describe", value: `kubectl describe pod ${ns}` },
      { label: "Port-forward…", value: "__pf" },
      { label: "Delete (restart via its controller)", value: "__delete" },
    ],
    { title: pod.name },
  );
  if (!action) return;
  if (action === "__delete") {
    if (!(await confirmPick(`Delete pod ${pod.name}?`, "Delete pod", "Its Deployment/StatefulSet will create a replacement."))) return;
    if ((await kubectl(`delete pod ${ns}`)) !== null) toast.success(`Deleted ${pod.name}`);
    return;
  }
  if (action === "__pf") {
    const ports = await inputBox({ title: "Ports (local:remote)", value: "8080:80" });
    if (!ports) return;
    app().openTerminal({ command: `kubectl port-forward ${ns} ${quoteShellArg(ports)}` });
    return;
  }
  app().openTerminal({ command: action });
}

// ── processes ─────────────────────────────────────────────────────────────

export async function processList(): Promise<void> {
  const r = await native.runCommand(IS_WINDOWS ? "tasklist /fo csv /nh" : "ps -Ao pid=,pcpu=,rss=,comm=,args=", null, 15).catch(() => null);
  if (!r || r.exit_code !== 0) return void toast.error("Could not list processes");
  const procs = (IS_WINDOWS ? parseTasklist(r.stdout) : parsePs(r.stdout)).slice(0, 400);
  const p = await quickPick(
    procs.map((x) => ({
      label: x.name,
      description: `pid ${x.pid}${IS_WINDOWS ? "" : ` · ${x.cpu.toFixed(1)}% CPU`} · ${x.memMb.toFixed(0)} MB`,
      detail: x.command.slice(0, 160),
      keywords: [String(x.pid), x.command],
      value: x,
    })),
    { title: IS_WINDOWS ? "Processes (by memory)" : "Processes (by CPU)", placeholder: "Search by name, pid or command line" },
  );
  if (!p) return;
  const action = await quickPick(
    [
      { label: `Kill ${p.name} (pid ${p.pid})`, value: "kill" },
      ...(IS_WINDOWS ? [] : [{ label: "Force kill (SIGKILL)", value: "kill9" }]),
      { label: "Copy pid", value: "copy" },
    ],
    { title: p.command.slice(0, 80) },
  );
  if (action === "copy") return void (await writeTerminalClipboard(String(p.pid)));
  if (!action || !(await confirmPick(`Kill ${p.name} (pid ${p.pid})?`, "Kill"))) return;
  const cmd = IS_WINDOWS ? `taskkill /PID ${p.pid} /F` : `kill ${action === "kill9" ? "-9 " : ""}${p.pid}`;
  const res = await native.runCommand(cmd, null, 10);
  if (res.exit_code === 0) toast.success(`Killed ${p.name}`);
  else toast.error("Kill failed", { description: (res.stderr || res.stdout).trim().slice(0, 300) });
}

// ── scheduled commands ────────────────────────────────────────────────────

const schedules: { id: number; leaf: number; command: string; label: string; cancel: () => void }[] = [];
let scheduleSeq = 1;

export async function scheduleCommand(): Promise<void> {
  const leaf = app().activeTerminalLeaf();
  if (leaf === null) return void toast.error("Focus a terminal first");
  const command = await inputBox({ title: "Command to schedule", value: lastFinishedCommand(leaf)?.command ?? "" });
  if (!command) return;
  const when = await inputBox({ title: "When?", placeholder: '"in 10m", "at 17:30", "every 5m"' });
  if (!when) return;
  let s;
  try {
    s = parseSchedule(when);
  } catch (e) {
    return void toast.error(e instanceof Error ? e.message : String(e));
  }
  const id = scheduleSeq++;
  const fire = () => {
    if (!leafTerminal(leaf) && !lastFinishedCommand(leaf) && !leafCwd(leaf)) return;
    if (isLeafCommandRunning(leaf)) {
      toast.warning("Skipped a scheduled run: the pane is busy", { description: command });
      return;
    }
    void guardedSubmit(leaf, command);
  };
  let cancel: () => void;
  let label: string;
  if (s.kind === "every") {
    const h = setInterval(fire, s.ms);
    cancel = () => clearInterval(h);
    label = `every ${Math.round(s.ms / 1000)}s`;
  } else {
    const h = setTimeout(() => {
      fire();
      const i = schedules.findIndex((x) => x.id === id);
      if (i >= 0) schedules.splice(i, 1);
    }, s.at - Date.now());
    cancel = () => clearTimeout(h);
    label = `at ${new Date(s.at).toLocaleTimeString()}`;
  }
  schedules.push({ id, leaf, command, label, cancel });
  toast.success(`Scheduled ${label}`, { description: command });
}

export async function manageSchedules(): Promise<void> {
  const pick = await quickPick(
    schedules.map((s) => ({ label: s.command, description: s.label, value: s.id })),
    { title: "Scheduled commands", placeholder: "Pick one to cancel it", emptyText: "Nothing scheduled" },
  );
  if (pick === undefined) return;
  const i = schedules.findIndex((s) => s.id === pick);
  if (i >= 0) {
    schedules[i].cancel();
    schedules.splice(i, 1);
    toast.info("Schedule cancelled");
  }
}

// ── panes / broadcast ─────────────────────────────────────────────────────

export function rotateActivePanes(dir: 1 | -1 = 1): void {
  const tab = app().tabs().find((t) => t.id === app().activeTabId());
  if (tab?.kind !== "terminal" || leafIds(tab.paneTree).length < 2) return void toast.info("Rotate needs a tab with two or more panes");
  app().setPaneTree(tab.id, rotatePanes(tab.paneTree, dir));
}

export async function sendToAllTerminals(): Promise<void> {
  const command = await inputBox({ title: "Run in every terminal pane (idle ones)", placeholder: "e.g. git pull" });
  if (!command) return;
  const risk = classifyCommand(command);
  if (risk && !(await confirmPick(`⚠ ${risk.reason}`, "Run it everywhere", command))) return;
  const leaves = terminalTabs().flatMap((t) => (t.kind === "terminal" ? leafIds(t.paneTree) : []));
  let sent = 0;
  let busy = 0;
  for (const leaf of leaves) {
    if (isLeafCommandRunning(leaf)) busy++;
    else {
      submitToLeaf(leaf, command);
      sent++;
    }
  }
  toast.success(`Sent to ${sent} pane${sent === 1 ? "" : "s"}`, { description: busy ? `${busy} busy pane(s) skipped` : undefined });
}

export const TERMINAL_EXTRA_ACTIONS = [
  { id: "terminal.findAll", label: "Terminal: Find in all terminals…", keywords: ["search", "grep", "all tabs", "output", "find", "everywhere"], run: findInAllTerminals },
  { id: "terminal.filterScrollback", label: "Terminal: Filter scrollback lines…", keywords: ["grep", "filter", "lines", "scrollback", "search", "matching"], run: filterScrollback },
  { id: "terminal.markLine", label: "Terminal: Mark current line", keywords: ["mark", "bookmark", "iterm", "remember", "position"], run: markLine },
  { id: "terminal.goToMark", label: "Terminal: Go to mark…", keywords: ["mark", "bookmark", "jump"], run: goToMark },
  { id: "terminal.copyMarkdown", label: "Terminal: Copy last command + output as Markdown", keywords: ["share", "markdown", "issue", "chat", "code block", "output"], run: copyCommandAsMarkdown },
  { id: "terminal.activateToolchain", label: "Terminal: Activate project toolchain (venv / nvm)", keywords: ["venv", "virtualenv", "python", "nvm", "fnm", "node version", "asdf", "activate"], run: activateToolchain },
  { id: "terminal.atFile", label: "Terminal: New terminal in the active file's folder", keywords: ["open terminal", "here", "folder", "cd"], run: newTerminalAtFile },
  { id: "terminal.kubernetes", label: "Terminal: Kubernetes contexts & pods…", keywords: ["kubernetes", "k8s", "kubectl", "pods", "logs", "exec", "context", "namespace"], run: kubernetes },
  { id: "terminal.processes", label: "Terminal: Processes (find & kill)…", keywords: ["process", "ps", "top", "task manager", "kill", "cpu", "memory"], run: processList },
  { id: "terminal.schedule", label: "Terminal: Schedule a command (in / at / every)…", keywords: ["schedule", "timer", "later", "cron", "repeat", "every", "delay"], run: scheduleCommand },
  { id: "terminal.schedules", label: "Terminal: Scheduled commands…", keywords: ["schedule", "cancel", "timers", "repeat"], run: manageSchedules },
  { id: "panes.rotate", label: "Panes: Rotate panes", keywords: ["rotate", "tmux", "cycle", "swap", "move"], run: () => rotateActivePanes(1) },
  { id: "terminal.sendAll", label: "Terminal: Run a command in all terminals…", keywords: ["broadcast", "all", "every", "panes", "tabs", "send"], run: sendToAllTerminals },
];
