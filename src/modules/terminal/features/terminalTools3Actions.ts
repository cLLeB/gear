// Terminal tools, part three: turn output into tables / JSON, diff two
// commands' output, a log viewer with level filtering, retry/watch/per-folder
// loops, parallel panes, wait-for-text alerts, scp/rsync, tail, serve a
// folder, a read-only SQLite browser and docker compose services.

import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { IS_WINDOWS } from "@/lib/platform";
import { native } from "@/modules/ai/lib/native";
import { osNotify } from "@/modules/agents/lib/notify";
import { openCompare, openTextViewer } from "@/modules/compare/CompareDialog";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { queryPath } from "@/modules/tools/dataTools";
import { inputBox, quickPick } from "@/modules/quick-pick";
import { currentWorkspaceEnv } from "@/modules/workspace/env";
import { onTerminalOutputLines } from "../lib/outputTap";
import { writeTerminalClipboard } from "../lib/terminalClipboard";
import { lastFinishedCommand, leafCommandOutput, leafCwd, listLeafCommands, serializeLeaf, submitToLeaf } from "../lib/useTerminalSession";
import { targetLeaf } from "./sessionTools";
import {
  composeServices,
  extractJsonBlocks,
  filterLog,
  forEachDirCommand,
  LOG_LEVELS,
  logLevelCounts,
  packageDirs,
  parseColumnar,
  parseComposePs,
  retryCommand,
  rowsToCsv,
  rowsToJson,
  rowsToMarkdown,
  serveCommand,
  tailCommand,
  transferCommand,
  watchCommand,
  type LogLevel,
  type Shell,
} from "./terminalTools3";

const SHELL: Shell = IS_WINDOWS ? "powershell" : "posix";

function needLeaf(): number | null {
  const l = targetLeaf();
  if (l === null) toast.info("Focus a terminal first");
  return l;
}

/** Run in the target terminal, or a new one when there is none. */
function run(command: string, cwd?: string | null): void {
  const l = targetLeaf();
  if (l !== null && !cwd) submitToLeaf(l, command);
  else app().openTerminal({ cwd: cwd ?? app().workspaceRoot() ?? null, command });
}

function lastOutput(): string | null {
  const l = needLeaf();
  if (l === null) return null;
  const out = lastFinishedCommand(l)?.output;
  if (!out?.trim()) {
    toast.info("No captured output from the last command (needs shell integration)");
    return null;
  }
  return out;
}

async function outputAsTable(): Promise<void> {
  const out = lastOutput();
  if (!out) return;
  const t = parseColumnar(out);
  if (!t) return void toast.info("The output doesn't look like columns");
  const pick = await quickPick(
    [
      { label: "View as a table", value: "view" },
      { label: "Copy as CSV", value: "csv" },
      { label: "Copy as JSON", value: "json" },
      { label: "Copy as Markdown table", value: "md" },
    ],
    { title: `${t.rows.length} row(s) × ${t.header.length} column(s): ${t.header.join(", ").slice(0, 80)}` },
  );
  if (!pick) return;
  if (pick === "view") return openTextViewer("Output as table", `${rowsToMarkdown(t.header, t.rows)}\n`, "markdown");
  const text = pick === "csv" ? rowsToCsv(t.header, t.rows) : pick === "json" ? rowsToJson(t.header, t.rows) : `${rowsToMarkdown(t.header, t.rows)}\n`;
  await writeTerminalClipboard(text);
  toast.success("Copied");
}

async function jsonFromOutput(): Promise<void> {
  const out = lastOutput();
  if (!out) return;
  const blocks = extractJsonBlocks(out);
  if (!blocks.length) return void toast.info("No JSON in the last output");
  const value = blocks.length === 1 ? blocks[0] : blocks;
  const path = await inputBox({ title: `${blocks.length} JSON value(s) found — optional JSONPath filter`, placeholder: "leave empty to view all · $.items[*].name · $..id", value: "" });
  if (path === undefined) return;
  try {
    const result = path.trim() ? queryPath(value, path).map((h) => h.value) : value;
    openTextViewer(path.trim() ? `JSONPath ${path}` : "JSON from output", JSON.stringify(result, null, 2), "json");
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  }
}

async function diffTwoOutputs(): Promise<void> {
  const l = needLeaf();
  if (l === null) return;
  const cmds = listLeafCommands(l).filter((c) => c.line >= 0).reverse();
  if (cmds.length < 2) return void toast.info("Run at least two commands in this pane first");
  const items = cmds.map((c) => ({ label: c.command, description: `${c.exitCode === 0 ? "✓" : c.exitCode === null ? "…" : `✗ ${c.exitCode}`}${c.finishedAt ? ` · ${new Date(c.finishedAt).toLocaleTimeString()}` : ""}`, value: c.index }));
  const a = await quickPick(items, { title: "First command (older)" });
  if (a === undefined) return;
  const b = await quickPick(items.filter((i) => i.value !== a), { title: "Compare with" });
  if (b === undefined) return;
  const [first, second] = a < b ? [a, b] : [b, a];
  const name = (i: number) => cmds.find((c) => c.index === i)?.command ?? "";
  openCompare({ title: "Compare command output", originalLabel: name(first), modifiedLabel: name(second), original: leafCommandOutput(l, first) ?? "", modified: leafCommandOutput(l, second) ?? "" });
}

async function logViewer(): Promise<void> {
  const l = needLeaf();
  if (l === null) return;
  const text = serializeLeaf(l, "text") ?? "";
  const lines = text.split(/\r?\n/);
  const counts = logLevelCounts(lines);
  const min = await quickPick<LogLevel>(
    LOG_LEVELS.map((lv) => ({ label: `${lv.toUpperCase()} and above`, description: `${LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(lv) + 1).reduce((n, x) => n + counts[x], 0)} line(s)`, value: lv })),
    { title: `Log levels: ${LOG_LEVELS.filter((x) => counts[x]).map((x) => `${x} ${counts[x]}`).join(" · ") || "none detected"}` },
  );
  if (!min) return;
  const hits = filterLog(lines, min);
  if (!hits.length) return void toast.info("No matching lines");
  const icon: Record<LogLevel, string> = { fatal: "💀", error: "⛔", warn: "⚠", info: "ℹ", debug: "🐞", trace: "·" };
  const pick = await quickPick(
    [{ label: "📄 Open filtered log in a viewer", value: -1 }, ...hits.slice(-2000).reverse().map((h) => ({ label: `${icon[h.level]} ${h.line.trim().slice(0, 200)}`, value: h.index }))],
    { title: `${hits.length} line(s) at ${min} or above (newest first)` },
  );
  if (pick === undefined) return;
  if (pick === -1) return openTextViewer(`Log — ${min}+`, hits.map((h) => h.line).join("\n"), "log");
  const { scrollLeafToLine } = await import("../lib/useTerminalSession");
  scrollLeafToLine(l, pick);
}

async function retryCmd(): Promise<void> {
  const l = targetLeaf();
  const last = l !== null ? lastFinishedCommand(l)?.command : undefined;
  const cmd = await inputBox({ title: "Retry until it succeeds", placeholder: "command", value: last ?? "" });
  if (!cmd) return;
  const opts = await quickPick(
    [
      { label: "5 attempts, 2s → 4s → 8s…", value: [5, 2] as const },
      { label: "10 attempts, 1s → 2s → 4s…", value: [10, 1] as const },
      { label: "3 attempts, 5s → 10s → 20s", value: [3, 5] as const },
    ],
    { title: "Backoff" },
  );
  if (opts) run(retryCommand(cmd, opts[0], opts[1], SHELL));
}

async function watchCmd(): Promise<void> {
  const cmd = await inputBox({ title: "Watch a command (re-run on an interval)", placeholder: "kubectl get pods · git status -s · ls -la" });
  if (!cmd) return;
  const secs = await quickPick([2, 5, 10, 30, 60].map((n) => ({ label: `Every ${n}s`, value: n })), { title: "Interval" });
  if (!secs) return;
  if (!app().splitAndRun("row", watchCommand(cmd, secs, SHELL))) app().openTerminal({ command: watchCommand(cmd, secs, SHELL) });
}

async function eachPackageCmd(): Promise<void> {
  const root = app().workspaceRoot();
  if (!root) return void toast.error("Open a folder first");
  const g = await native.glob({ pattern: "**/{package.json,Cargo.toml,pyproject.toml,go.mod}", root, maxResults: 500 }).catch(() => null);
  const dirs = packageDirs((g?.hits ?? []).map((h) => h.rel));
  if (!dirs.length) return void toast.info("No packages found");
  const scope = await quickPick(
    [
      { label: `All ${dirs.length} package folders`, value: dirs },
      { label: "Sub-packages only (skip the root)", value: dirs.filter((d) => d !== ".") },
      ...dirs.map((d) => ({ label: d, description: "just this one", value: [d] })),
    ],
    { title: "Run in which folders?" },
  );
  if (!scope?.length) return;
  const cmd = await inputBox({ title: `Command to run in ${scope.length} folder(s)`, placeholder: "npm test · cargo check · git status -s" });
  if (!cmd) return;
  const stop = await quickPick([{ label: "Keep going on failure", value: false }, { label: "Stop at the first failure", value: true }], { title: "On failure" });
  if (stop === undefined) return;
  app().openTerminal({ cwd: root, command: forEachDirCommand(scope, cmd, SHELL, stop) });
}

async function parallelPanes(): Promise<void> {
  const raw = await inputBox({ title: "Commands to run side by side (separate with ;;)", placeholder: "npm run dev ;; npm run test -- --watch ;; npx tsc -w" });
  if (!raw) return;
  const cmds = raw.split(";;").map((c) => c.trim()).filter(Boolean);
  if (!cmds.length) return;
  if (app().activeTerminalLeaf() === null) {
    app().openTerminal({ command: cmds[0] });
    await new Promise((r) => setTimeout(r, 600));
  } else submitToLeaf(app().activeTerminalLeaf()!, cmds[0]);
  for (let i = 1; i < cmds.length; i++) {
    if (!app().splitAndRun(i % 2 ? "row" : "col", cmds[i])) return void toast.error("Couldn't split the pane");
    await new Promise((r) => setTimeout(r, 300));
  }
}

const waits = new Map<number, () => void>();

async function waitForText(): Promise<void> {
  const l = needLeaf();
  if (l === null) return;
  if (waits.has(l)) {
    waits.get(l)!();
    waits.delete(l);
    return void toast.info("Stopped waiting");
  }
  const text = await inputBox({ title: "Notify me when this pane prints… (text or /regex/)", placeholder: "Compiled successfully · listening on · /error|failed/i" });
  if (!text) return;
  const rx = /^\/(.+)\/([a-z]*)$/.exec(text);
  let re: RegExp;
  try {
    re = rx ? new RegExp(rx[1], rx[2]) : new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  } catch (e) {
    return void toast.error(String(e));
  }
  const off = onTerminalOutputLines((leafId, lines) => {
    if (leafId !== l) return;
    const hit = lines.find((x) => re.test(x));
    if (!hit) return;
    off();
    waits.delete(l);
    toast.success(`Terminal printed: ${hit.trim().slice(0, 120)}`);
    void osNotify("Gear — text appeared", hit.trim().slice(0, 200));
  });
  waits.set(l, off);
  toast.info(`Waiting for "${text}" (run again to cancel)`);
}

async function transferCmd(): Promise<void> {
  const direction = await quickPick([{ label: "⬆ Upload to a server", value: "upload" as const }, { label: "⬇ Download from a server", value: "download" as const }], { title: "Copy files over SSH" });
  if (!direction) return;
  const host = await inputBox({ title: "Host", placeholder: "user@server or an ~/.ssh/config alias" });
  if (!host) return;
  const ed = getActiveEditor()?.path;
  const local = await inputBox({ title: direction === "upload" ? "Local file or folder" : "Local destination", value: direction === "upload" ? ed ?? "." : "." });
  if (!local) return;
  const remote = await inputBox({ title: direction === "upload" ? "Remote destination" : "Remote file or folder", value: "~/" });
  if (!remote) return;
  const tool = await quickPick(
    [
      { label: "rsync (resumable, only changed files)", value: "rsync" as const },
      { label: "scp", value: "scp" as const },
    ],
    { title: "Tool" },
  );
  if (!tool) return;
  run(transferCommand({ direction, host, local, remote, tool, recursive: true }));
}

function tailActiveFile(): void {
  const path = getActiveEditor()?.path;
  if (!path) return void toast.info("Open the log file in the editor first");
  const cmd = tailCommand(path, SHELL);
  if (!app().splitAndRun("col", cmd)) app().openTerminal({ command: cmd });
}

async function serveFolder(): Promise<void> {
  const root = app().workspaceRoot();
  const ed = getActiveEditor()?.path;
  const dir = await quickPick(
    [
      ...(root ? [{ label: "Workspace root", description: root, value: root }] : []),
      ...(ed ? [{ label: "Folder of the active file", description: ed.replace(/[\\/][^\\/]*$/, ""), value: ed.replace(/[\\/][^\\/]*$/, "") }] : []),
      ...(root ? ["dist", "build", "public", "out", "site", "docs"].map((d) => ({ label: d, description: `${root}/${d}`, value: `${root}/${d}` })) : []),
    ],
    { title: "Serve which folder over HTTP?" },
  );
  if (!dir) return;
  const port = 8000 + Math.floor(Math.random() * 900);
  const probe = await native.runCommand(IS_WINDOWS ? "where python & where node" : "command -v python3 || command -v python; command -v node", null, 10).catch(() => null);
  const out = probe?.stdout ?? "";
  const python = /python3/.test(out) ? "python3" : /python/i.test(out) ? "python" : undefined;
  const cmd = serveCommand({ python, node: /node/i.test(out) }, port);
  if (!cmd) return void toast.error("Needs Python or Node.js on PATH");
  app().openTerminal({ cwd: dir, command: cmd });
  setTimeout(() => app().openPreview(`http://localhost:${port}/`), 1800);
  toast.success(`Serving on http://localhost:${port}/`);
}

type SqliteResult = { columns: string[]; rows: (string | null)[][]; truncated: boolean };

async function sqliteBrowser(): Promise<void> {
  const ed = getActiveEditor()?.path;
  let db = ed && /\.(db|sqlite3?|db3)$/i.test(ed) ? ed : null;
  const root = app().workspaceRoot();
  if (!db) {
    const g = root ? await native.glob({ pattern: "**/*.{db,sqlite,sqlite3,db3}", root, maxResults: 200 }).catch(() => null) : null;
    const hits = (g?.hits ?? []).filter((h) => !/node_modules/.test(h.rel));
    const pick = await quickPick([...hits.map((h) => ({ label: h.rel, value: h.path })), { label: "Enter a path…", value: "" }], { title: "Open which SQLite database?" });
    if (pick === undefined) return;
    db = pick || (await inputBox({ title: "Database path" })) || null;
    if (!db) return;
  }
  const q = (sql: string, maxRows = 500) => invoke<SqliteResult>("sqlite_query", { path: db, sql, maxRows, workspace: currentWorkspaceEnv() });
  try {
    for (;;) {
      const tables = await q("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name");
      const counts = await Promise.all(tables.rows.map((r) => q(`SELECT count(*) FROM "${String(r[0]).replace(/"/g, '""')}"`).then((c) => c.rows[0]?.[0] ?? "?").catch(() => "?")));
      const pick = await quickPick<{ kind: "sql" | "table"; name: string }>(
        [
          { label: "⌨ Run a SQL query (read-only)…", value: { kind: "sql" as const, name: "" } },
          ...tables.rows.map((r, i) => ({ label: `${r[1] === "view" ? "👁" : "▦"} ${r[0]}`, description: `${counts[i]} rows`, value: { kind: "table" as const, name: String(r[0]) } })),
        ],
        { title: `${db.replace(/^.*[\\/]/, "")} — ${tables.rows.length} table(s)` },
      );
      if (!pick) return;
      let sql: string;
      if (pick.kind === "sql") {
        const s = await inputBox({ title: "SQL (read-only)", placeholder: "SELECT * FROM users WHERE created_at > date('now','-7 day')" });
        if (!s) continue;
        sql = s;
      } else {
        const action = await quickPick(
          [
            { label: "First 200 rows", value: `SELECT * FROM "${pick.name}" LIMIT 200` },
            { label: "Schema (CREATE statement + columns)", value: `schema` },
            { label: "Copy all rows as CSV (up to 5000)", value: `csv` },
          ],
          { title: pick.name },
        );
        if (!action) continue;
        if (action === "schema") {
          const create = await q(`SELECT sql FROM sqlite_master WHERE name = '${pick.name.replace(/'/g, "''")}'`);
          const cols = await q(`PRAGMA table_info("${pick.name}")`);
          openTextViewer(`${pick.name} schema`, `${create.rows[0]?.[0] ?? ""};\n\n${rowsToMarkdown(cols.columns, cols.rows.map((r) => r.map((c) => c ?? "")))}\n`, "sql");
          return;
        }
        if (action === "csv") {
          const r = await q(`SELECT * FROM "${pick.name}"`, 5000);
          await writeTerminalClipboard(rowsToCsv(r.columns, r.rows.map((x) => x.map((c) => c ?? ""))));
          return void toast.success(`Copied ${r.rows.length} row(s)${r.truncated ? " (truncated)" : ""}`);
        }
        sql = action;
      }
      const r = await q(sql, 1000);
      openTextViewer(sql.slice(0, 60), `${rowsToMarkdown(r.columns, r.rows.map((x) => x.map((c) => c ?? "NULL")))}\n\n${r.rows.length} row(s)${r.truncated ? " — truncated" : ""}\n`, "markdown");
      return;
    }
  } catch (e) {
    toast.error(String(e));
  }
}

async function composeServicesCmd(): Promise<void> {
  const root = app().workspaceRoot();
  const cwd = (targetLeaf() !== null ? leafCwd(targetLeaf()!) : null) ?? root;
  if (!cwd) return void toast.error("Open a folder first");
  const ps = await native.runCommand("docker compose ps -a --format json", cwd, 20).catch(() => null);
  let rows = ps && ps.exit_code === 0 ? parseComposePs(ps.stdout) : [];
  if (!rows.length) {
    let declared: string[] = [];
    for (const f of ["compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"]) {
      const r = await native.readFile(`${cwd}/${f}`).catch(() => null);
      if (r?.kind === "text") {
        declared = composeServices(r.content);
        break;
      }
    }
    if (!declared.length) return void toast.info(ps?.stderr.trim() || "No docker compose project here");
    rows = declared.map((s) => ({ service: s, name: s, state: "not created", status: "", ports: "" }));
  }
  const svc = await quickPick(
    [
      { label: "▶ Up all (detached)", value: { service: "", all: "up" } },
      { label: "■ Down all", value: { service: "", all: "down" } },
      ...rows.map((r) => ({ label: `${r.state === "running" ? "🟢" : r.state === "exited" ? "🔴" : "⚪"} ${r.service}`, description: [r.status || r.state, r.ports].filter(Boolean).join(" · "), value: { service: r.service, all: "" } })),
    ],
    { title: `docker compose — ${rows.length} service(s)` },
  );
  if (!svc) return;
  if (svc.all === "up") return run("docker compose up -d", cwd);
  if (svc.all === "down") return run("docker compose down", cwd);
  const act = await quickPick(
    [
      { label: "Follow logs", value: `docker compose logs -f --tail 200 ${svc.service}` },
      { label: "Restart", value: `docker compose restart ${svc.service}` },
      { label: "Start / up", value: `docker compose up -d ${svc.service}` },
      { label: "Stop", value: `docker compose stop ${svc.service}` },
      { label: "Shell into it", value: `docker compose exec ${svc.service} sh -c "bash || sh"` },
      { label: "Rebuild and restart", value: `docker compose up -d --build ${svc.service}` },
    ],
    { title: svc.service },
  );
  if (act) app().openTerminal({ cwd, command: act });
}

export const TERMINAL_TOOLS3_ACTIONS = [
  { id: "terminal.outputTable", label: "Terminal: Last output as a table (CSV / JSON / Markdown)…", keywords: ["table", "columns", "csv", "json", "docker ps", "kubectl", "parse output"], run: outputAsTable },
  { id: "terminal.outputJson", label: "Terminal: JSON from last output (with JSONPath)…", keywords: ["json", "jq", "curl", "api", "pretty", "jsonpath", "output"], run: jsonFromOutput },
  { id: "terminal.diffOutputs", label: "Terminal: Compare the output of two commands…", keywords: ["diff", "compare", "output", "before after", "regression"], run: diffTwoOutputs },
  { id: "terminal.logViewer", label: "Terminal: Log viewer — filter scrollback by level…", keywords: ["log", "level", "error", "warn", "filter", "logs", "viewer"], run: logViewer },
  { id: "terminal.retry", label: "Terminal: Retry a command until it succeeds (backoff)…", keywords: ["retry", "backoff", "flaky", "until", "repeat", "again"], run: retryCmd },
  { id: "terminal.watch", label: "Terminal: Watch a command (re-run every N seconds)…", keywords: ["watch", "interval", "repeat", "refresh", "poll", "loop"], run: watchCmd },
  { id: "terminal.eachPackage", label: "Terminal: Run a command in every package folder (monorepo)…", keywords: ["monorepo", "workspaces", "packages", "each", "foreach", "lerna", "all folders"], run: eachPackageCmd },
  { id: "terminal.parallel", label: "Terminal: Run commands side by side in split panes…", keywords: ["parallel", "concurrently", "split", "panes", "dev", "multiple"], run: parallelPanes },
  { id: "terminal.waitFor", label: "Terminal: Notify when the pane prints… (toggle)", keywords: ["wait", "notify", "alert", "text", "regex", "ready", "listening"], run: waitForText },
  { id: "terminal.transfer", label: "Terminal: Copy files to / from a server (scp / rsync)…", keywords: ["scp", "rsync", "upload", "download", "ssh", "deploy", "copy"], run: transferCmd },
  { id: "terminal.tailFile", label: "Terminal: Tail the active file in a split", keywords: ["tail", "follow", "log", "watch file", "Get-Content -Wait"], run: tailActiveFile },
  { id: "terminal.serveFolder", label: "Terminal: Serve a folder over HTTP and preview it…", keywords: ["serve", "http", "static", "server", "preview", "localhost", "http.server"], run: serveFolder },
  { id: "terminal.sqlite", label: "Tools: SQLite browser (read-only)…", keywords: ["sqlite", "database", "db", "sql", "tables", "browser", "query"], run: sqliteBrowser },
  { id: "terminal.compose", label: "Terminal: Docker Compose services…", keywords: ["docker", "compose", "services", "logs", "restart", "containers", "up", "down"], run: composeServicesCmd },
];
