// Extension host: discovers extensions in ~/.gear/extensions, asks for
// permission consent, runs each enabled extension in its own Web Worker, and
// answers its API calls (after checking the manifest's permissions). Commands,
// status bar items, logs and configuration live here too.

import { homeDir } from "@tauri-apps/api/path";
import { toast } from "sonner";
import { create } from "zustand";
import { app } from "@/app/appBridge";
import { IS_WINDOWS } from "@/lib/platform";
import { quoteShellArg } from "@/lib/shellQuote";
import { native } from "@/modules/ai/lib/native";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { confirmPick, inputBox, quickPick } from "@/modules/quick-pick";
import { workerSource, type ModuleMap } from "./bootstrap";
import { activatesOn, checkCall, parseManifest, PERMISSIONS, resolveExtensionPath, type ExtensionManifest, type Permission } from "./manifest";

export interface Installed {
  dir: string;
  manifest: ExtensionManifest | null;
  error: string | null;
}

export type RunState = "stopped" | "starting" | "active" | "error";

export interface LogEntry {
  at: number;
  level: "info" | "warn" | "error" | "debug";
  text: string;
}

interface ExtStore {
  root: string | null;
  installed: Installed[];
  enabled: Record<string, boolean>;
  state: Record<string, RunState>;
  errors: Record<string, string>;
  status: Record<string, { text: string; tooltip?: string; command?: string }>;
  logs: Record<string, LogEntry[]>;
}

const ENABLED_KEY = "gear-ext-enabled";
const GRANTED_KEY = (id: string) => `gear-ext-granted:${id}`;
const STORAGE_KEY = (id: string) => `gear-ext-storage:${id}`;
const CONFIG_KEY = (id: string) => `gear-ext-config:${id}`;

function loadJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / unavailable */
  }
}

export const useExtStore = create<ExtStore>(() => ({ root: null, installed: [], enabled: loadJson(ENABLED_KEY, {}), state: {}, errors: {}, status: {}, logs: {} }));

export function log(id: string, level: LogEntry["level"], text: string): void {
  useExtStore.setState((s) => ({ logs: { ...s.logs, [id]: [...(s.logs[id] ?? []), { at: Date.now(), level, text }].slice(-2000) } }));
}

// ── discovery ─────────────────────────────────────────────────────────────

export async function extensionsRoot(): Promise<string> {
  const cached = useExtStore.getState().root;
  if (cached) return cached;
  const root = `${(await homeDir()).replace(/\\/g, "/").replace(/\/+$/, "")}/.gear/extensions`;
  await native.createDir(root).catch(() => {});
  useExtStore.setState({ root });
  return root;
}

export async function scan(): Promise<Installed[]> {
  const root = await extensionsRoot();
  const dirs = (await native.readDir(root).catch(() => [])).filter((e) => e.kind === "dir" || e.kind === "symlink");
  const installed: Installed[] = [];
  for (const d of dirs) {
    const dir = `${root}/${d.name}`;
    const r = await native.readFile(`${dir}/gear-extension.json`).catch((e) => ({ kind: "error" as const, e }));
    if (r.kind !== "text") {
      if (r.kind === "error") continue; // not an extension folder
      installed.push({ dir, manifest: null, error: "gear-extension.json is not a text file" });
      continue;
    }
    try {
      installed.push({ dir, manifest: parseManifest(r.content), error: null });
    } catch (e) {
      installed.push({ dir, manifest: null, error: String((e as Error).message ?? e) });
    }
  }
  // Two folders with one id: the first wins, the rest are flagged.
  const seen = new Set<string>();
  for (const x of installed) {
    if (!x.manifest) continue;
    if (seen.has(x.manifest.id)) x.error = `Duplicate id ${x.manifest.id} (another folder has it)`;
    seen.add(x.manifest.id);
  }
  installed.sort((a, b) => (a.manifest?.name ?? a.dir).localeCompare(b.manifest?.name ?? b.dir));
  useExtStore.setState({ installed });
  return installed;
}

export function byId(id: string): Installed | undefined {
  return useExtStore.getState().installed.find((x) => x.manifest?.id === id && !x.error);
}

// ── consent ───────────────────────────────────────────────────────────────

function granted(id: string): Permission[] {
  return loadJson<Permission[]>(GRANTED_KEY(id), []);
}

/** Ask for any permissions not granted yet; false when declined. */
async function ensureConsent(m: ExtensionManifest): Promise<boolean> {
  const have = granted(m.id);
  const missing = m.permissions.filter((p) => !have.includes(p));
  if (!missing.length) return true;
  const ok = await confirmPick(
    `${m.name} ${have.length ? "wants new permissions" : "asks for permissions"}`,
    "Allow and enable",
    missing.map((p) => PERMISSIONS[p]).join(" · "),
  );
  if (ok) saveJson(GRANTED_KEY(m.id), m.permissions);
  return ok;
}

// ── workers ───────────────────────────────────────────────────────────────

interface Running {
  worker: Worker;
  manifest: ExtensionManifest;
  url: string;
  activated: Promise<void>;
  invokes: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  registered: Set<string>;
  seq: number;
}

const running = new Map<string, Running>();

const MAX_FILES = 400;
const MAX_BYTES = 8 * 1024 * 1024;

async function readModules(dir: string): Promise<ModuleMap> {
  const hits = await native.glob({ pattern: "**/*.{js,cjs,json}", root: dir, maxResults: MAX_FILES + 1 });
  if (hits.hits.length > MAX_FILES) throw new Error(`More than ${MAX_FILES} .js / .json files — bundle the extension into one file`);
  const out: ModuleMap = {};
  let bytes = 0;
  for (const h of hits.hits) {
    const rel = h.rel.replace(/\\/g, "/");
    if (rel === "gear-extension.json") continue;
    const r = await native.readFile(h.path);
    if (r.kind !== "text") continue;
    bytes += r.content.length;
    if (bytes > MAX_BYTES) throw new Error("The extension is larger than 8 MB");
    out[rel] = r.content;
  }
  return out;
}

export async function start(id: string): Promise<void> {
  if (running.has(id)) return running.get(id)!.activated;
  const ext = byId(id);
  if (!ext?.manifest) throw new Error(`Extension ${id} isn't installed`);
  const m = ext.manifest;
  if (m.permissions.some((p) => !granted(id).includes(p)) && !(await ensureConsent(m))) throw new Error("Permissions not granted");
  setState(id, "starting");
  let source: string;
  try {
    source = workerSource(m, await readModules(ext.dir));
  } catch (e) {
    setState(id, "error", String((e as Error).message ?? e));
    throw e;
  }
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const worker = new Worker(url, { name: `ext:${id}` });
  let done!: () => void;
  let fail!: (e: Error) => void;
  const r: Running = { worker, manifest: m, url, activated: new Promise<void>((res, rej) => ((done = res), (fail = rej))), invokes: new Map(), registered: new Set(), seq: 0 };
  running.set(id, r);
  r.activated.catch(() => {});
  worker.onmessage = (e: MessageEvent) => void onMessage(r, e.data as Record<string, unknown>, done, fail);
  worker.onerror = (e) => {
    e.preventDefault();
    const msg = e.message || "Worker error";
    log(id, "error", msg);
    setState(id, "error", msg);
    fail(new Error(msg));
  };
  worker.postMessage({ type: "activate" });
  log(id, "info", `Starting ${m.name} ${m.version}`);
  return r.activated;
}

export async function stop(id: string): Promise<void> {
  const r = running.get(id);
  if (!r) return;
  running.delete(id);
  r.worker.postMessage({ type: "deactivate" });
  // Give deactivate() a moment, then terminate regardless.
  await new Promise((res) => setTimeout(res, 300));
  r.worker.terminate();
  URL.revokeObjectURL(r.url);
  for (const p of r.invokes.values()) p.reject(new Error("Extension stopped"));
  useExtStore.setState((s) => {
    const { [id]: _, ...status } = s.status;
    return { status };
  });
  setState(id, "stopped");
  log(id, "info", "Stopped");
}

export async function restart(id: string): Promise<void> {
  await stop(id);
  await scan();
  await start(id).catch((e) => toast.error(`${id} failed to start`, { description: String(e) }));
}

function setState(id: string, st: RunState, error?: string): void {
  useExtStore.setState((s) => ({ state: { ...s.state, [id]: st }, errors: error ? { ...s.errors, [id]: error } : (() => { const { [id]: _, ...rest } = s.errors; return rest; })() }));
}

async function onMessage(r: Running, m: Record<string, unknown>, done: () => void, fail: (e: Error) => void): Promise<void> {
  const id = r.manifest.id;
  switch (m.type) {
    case "log":
      log(id, m.level as LogEntry["level"], String(m.text));
      return;
    case "activated":
      if (m.error) {
        log(id, "error", `activate() failed: ${String(m.error)}`);
        setState(id, "error", String(m.error).split("\n")[0]);
        fail(new Error(String(m.error)));
      } else {
        setState(id, "active");
        done();
      }
      return;
    case "invokeResult": {
      const p = r.invokes.get(m.id as number);
      r.invokes.delete(m.id as number);
      if (m.error !== undefined) p?.reject(new Error(String(m.error)));
      else p?.resolve(m.value);
      return;
    }
    case "call": {
      const reply = (value: unknown, error?: string) => r.worker.postMessage(error === undefined ? { type: "result", id: m.id, value: value ?? null } : { type: "result", id: m.id, error });
      try {
        const args = (m.args as unknown[]) ?? [];
        const problem = checkCall(r.manifest, m.method as string, args);
        if (problem) throw new Error(problem);
        reply(await api(r, m.method as string, args));
      } catch (e) {
        reply(null, String((e as Error)?.message ?? e));
      }
      return;
    }
  }
}

function cwdFor(r: Running, cwd: unknown): string | null {
  const root = app().workspaceRoot();
  return typeof cwd === "string" && cwd ? resolveExtensionPath(cwd, root, r.manifest.permissions) : root;
}

async function api(r: Running, method: string, args: unknown[]): Promise<unknown> {
  const id = r.manifest.id;
  const root = app().workspaceRoot();
  switch (method) {
    case "log":
      log(id, "info", args.map(String).join(" "));
      return null;
    case "commands.register":
      r.registered.add(String(args[0]));
      return null;
    case "commands.execute":
      return runCommand(String(args[0]), args.slice(1));
    case "window.showMessage": {
      const [level, message, actions] = args as ["info" | "warning" | "error", string, string[]];
      const show = level === "error" ? toast.error : level === "warning" ? toast.warning : toast.info;
      return new Promise((resolve) => {
        show(message, {
          description: r.manifest.name,
          action: actions[0] ? { label: actions[0], onClick: () => resolve(actions[0]) } : undefined,
          cancel: actions[1] ? { label: actions[1], onClick: () => resolve(actions[1]) } : undefined,
          onDismiss: () => resolve(null),
          onAutoClose: () => resolve(null),
        });
      });
    }
    case "window.quickPick": {
      const [items, opts] = args as [unknown[], { title?: string; placeholder?: string }];
      if (!Array.isArray(items)) throw new Error("quickPick needs an array of items");
      const idx = await quickPick(
        items.slice(0, 5000).map((it, i) => (typeof it === "string" ? { label: it, value: i } : { label: String((it as { label?: unknown }).label ?? ""), description: (it as { description?: string }).description, detail: (it as { detail?: string }).detail, value: i })),
        { title: opts.title ?? r.manifest.name, placeholder: opts.placeholder },
      );
      return idx === undefined ? null : items[idx];
    }
    case "window.inputBox": {
      const o = args[0] as { title?: string; placeholder?: string; value?: string };
      return (await inputBox({ title: o.title ?? r.manifest.name, placeholder: o.placeholder, value: o.value })) ?? null;
    }
    case "window.setStatus": {
      const [text, o] = args as [string | null, { tooltip?: string; command?: string }];
      useExtStore.setState((s) => {
        const { [id]: _, ...rest } = s.status;
        return { status: text === null ? rest : { ...rest, [id]: { text: text.slice(0, 60), tooltip: o.tooltip, command: o.command } } };
      });
      return null;
    }
    case "window.openFile":
      app().openFile(resolveExtensionPath(String(args[0]), root, [...r.manifest.permissions, "fs.any"]), typeof args[1] === "number" ? args[1] : undefined);
      return null;
    case "workspace.root":
      return root;
    case "config.get": {
      const key = String(args[0]);
      const def = r.manifest.contributes.configuration[key];
      if (!def) throw new Error(`Configuration ${key} isn't declared in contributes.configuration`);
      return loadJson<Record<string, unknown>>(CONFIG_KEY(id), {})[key] ?? def.default;
    }
    case "storage.get":
      return loadJson<Record<string, unknown>>(STORAGE_KEY(id), {})[String(args[0])] ?? null;
    case "storage.set": {
      const all = loadJson<Record<string, unknown>>(STORAGE_KEY(id), {});
      if (args[1] === null || args[1] === undefined) delete all[String(args[0])];
      else all[String(args[0])] = args[1];
      const text = JSON.stringify(all);
      if (text.length > 1_000_000) throw new Error("Extension storage is limited to 1 MB");
      localStorage.setItem(STORAGE_KEY(id), text);
      return null;
    }
    case "editor.active": {
      const ed = getActiveEditor();
      if (!ed) return null;
      const sel = ed.view.state.selection.main;
      const line = ed.view.state.doc.lineAt(sel.head);
      return { path: ed.path ?? null, language: ed.languageId, text: ed.view.state.doc.toString(), selection: { from: sel.from, to: sel.to, text: ed.view.state.sliceDoc(sel.from, sel.to) }, cursor: { line: line.number, column: sel.head - line.from + 1 } };
    }
    case "editor.replaceSelection":
    case "editor.insert":
    case "editor.setText": {
      const ed = getActiveEditor();
      if (!ed) throw new Error("No active editor");
      const text = String(args[0]);
      const sel = ed.view.state.selection.main;
      const change = method === "editor.setText" ? { from: 0, to: ed.view.state.doc.length, insert: text } : method === "editor.insert" ? { from: sel.head, insert: text } : { from: sel.from, to: sel.to, insert: text };
      ed.view.dispatch({ changes: change, userEvent: "input.extension" });
      return null;
    }
    case "workspace.readFile": {
      const p = resolveExtensionPath(String(args[0]), root, r.manifest.permissions);
      const res = await native.readFile(p);
      if (res.kind !== "text") throw new Error(res.kind === "binary" ? `${p} is binary` : `${p} is too large`);
      return res.content;
    }
    case "workspace.writeFile": {
      const p = resolveExtensionPath(String(args[0]), root, r.manifest.permissions);
      await native.writeFile(p, String(args[1]), "user");
      return null;
    }
    case "workspace.findFiles": {
      if (!root) throw new Error("No workspace folder is open");
      const res = await native.glob({ pattern: String(args[0]), root, maxResults: Math.min(Number(args[1]) || 500, 5000) });
      return res.hits.map((h) => h.rel.replace(/\\/g, "/"));
    }
    case "terminal.run": {
      const o = (args[1] ?? {}) as { cwd?: string };
      app().openTerminal({ command: String(args[0]), cwd: cwdFor(r, o.cwd) });
      return null;
    }
    case "shell.exec": {
      const o = (args[1] ?? {}) as { cwd?: string; timeout?: number };
      const out = await native.runCommand(String(args[0]), cwdFor(r, o.cwd), Math.min(Math.max(Number(o.timeout) || 60, 1), 600));
      return { stdout: out.stdout, stderr: out.stderr, code: out.exit_code, timedOut: out.timed_out };
    }
    case "clipboard.read":
      return navigator.clipboard.readText();
    case "clipboard.write":
      await navigator.clipboard.writeText(String(args[0]));
      return null;
    default:
      throw new Error(`Unknown API ${method}`);
  }
}

// ── commands and events ───────────────────────────────────────────────────

export interface ExtCommand {
  extId: string;
  extName: string;
  id: string;
  title: string;
}

export function allCommands(installed = useExtStore.getState().installed, enabled = useExtStore.getState().enabled): ExtCommand[] {
  return installed.flatMap((x) => (x.manifest && !x.error && enabled[x.manifest.id] ? x.manifest.contributes.commands.map((c) => ({ extId: x.manifest!.id, extName: x.manifest!.name, id: c.id, title: c.title })) : []));
}

/** Run an extension command, starting its extension first when needed. */
export async function runCommand(command: string, args: unknown[] = []): Promise<unknown> {
  const owner = allCommands().find((c) => c.id === command);
  if (!owner) throw new Error(`No enabled extension contributes ${command}`);
  await start(owner.extId);
  const r = running.get(owner.extId)!;
  const id = ++r.seq;
  return new Promise((resolve, reject) => {
    r.invokes.set(id, { resolve, reject });
    r.worker.postMessage({ type: "invoke", id, command, args });
  });
}

export function runCommandFromUi(command: string): void {
  runCommand(command).catch((e) => toast.error(`${command} failed`, { description: String((e as Error).message ?? e) }));
}

/** Send an event to every running extension; start the ones it activates. */
export function emit(name: string, payload: unknown, activation?: string): void {
  if (activation) {
    for (const x of useExtStore.getState().installed) {
      const m = x.manifest;
      if (m && !x.error && useExtStore.getState().enabled[m.id] && !running.has(m.id) && activatesOn(m, activation)) void start(m.id).catch(() => {});
    }
  }
  for (const r of running.values()) {
    void r.activated.then(() => r.worker.postMessage({ type: "event", name, payload })).catch(() => {});
  }
}

// ── enable / install ──────────────────────────────────────────────────────

export async function setEnabled(id: string, on: boolean): Promise<void> {
  const ext = byId(id);
  if (on && ext?.manifest && !(await ensureConsent(ext.manifest))) return;
  const enabled = { ...useExtStore.getState().enabled, [id]: on };
  useExtStore.setState({ enabled });
  saveJson(ENABLED_KEY, enabled);
  if (on && ext?.manifest && activatesOn(ext.manifest, "onStartup")) await start(id).catch((e) => toast.error(`${ext.manifest!.name} failed to start`, { description: String((e as Error).message ?? e) }));
  if (!on) await stop(id);
}

export function configValues(id: string): Record<string, unknown> {
  return loadJson(CONFIG_KEY(id), {});
}

export function setConfigValue(id: string, key: string, value: unknown): void {
  saveJson(CONFIG_KEY(id), { ...configValues(id), [key]: value });
  emit("configChange", { key });
}

/** Start every enabled extension that activates on startup. */
export async function bootExtensions(): Promise<void> {
  const installed = await scan().catch(() => []);
  const { enabled } = useExtStore.getState();
  for (const x of installed) {
    const m = x.manifest;
    if (m && !x.error && enabled[m.id] && activatesOn(m, "onStartup")) {
      // Never prompt at boot: an extension whose permissions grew waits for the user.
      if (m.permissions.some((p) => !granted(m.id).includes(p))) {
        setState(m.id, "error", "Needs permission — enable it again to review");
        continue;
      }
      void start(m.id).catch(() => {});
    }
  }
}

const sh = (s: string) => quoteShellArg(s, IS_WINDOWS);

async function copyInto(src: string, root: string, name: string): Promise<string> {
  const dest = `${root}/${name}`;
  const cmd = IS_WINDOWS ? `Copy-Item -Recurse -Force ${sh(src)} ${sh(dest)}` : `cp -R ${sh(src)} ${sh(dest)}`;
  const r = await native.runCommand(cmd, null, 120);
  if (r.exit_code !== 0) throw new Error(r.stderr || "copy failed");
  return dest;
}

export async function installFromFolder(src: string): Promise<void> {
  const r = await native.readFile(`${src.replace(/[\\/]+$/, "")}/gear-extension.json`).catch(() => null);
  if (r?.kind !== "text") return void toast.error("That folder has no gear-extension.json");
  const m = parseManifest(r.content);
  const root = await extensionsRoot();
  if (byId(m.id) && !(await confirmPick(`${m.name} is already installed`, "Replace it"))) return;
  if (byId(m.id)) await uninstall(m.id, false);
  await copyInto(src.replace(/[\\/]+$/, ""), root, m.id);
  await scan();
  toast.success(`Installed ${m.name} ${m.version}`, { action: { label: "Enable", onClick: () => void setEnabled(m.id, true) } });
}

export async function installFromGit(url: string): Promise<void> {
  const root = await extensionsRoot();
  const name = `git-${(url.replace(/\.git$/, "").split(/[/:]/).pop() ?? "ext").replace(/[^\w.-]/g, "")}-${Date.now().toString(36)}`;
  const t = toast.loading(`Cloning ${url}…`);
  const r = await native.runCommand(`git clone --depth 1 ${sh(url)} ${sh(`${root}/${name}`)}`, null, 300);
  toast.dismiss(t);
  if (r.exit_code !== 0) return void toast.error("git clone failed", { description: r.stderr });
  const installed = await scan();
  const hit = installed.find((x) => x.dir.endsWith(`/${name}`));
  if (!hit?.manifest) {
    await removeDir(`${root}/${name}`);
    await scan();
    return void toast.error("That repository isn't a Gear extension", { description: hit?.error ?? "No gear-extension.json at its root" });
  }
  toast.success(`Installed ${hit.manifest.name} ${hit.manifest.version}`, { action: { label: "Enable", onClick: () => void setEnabled(hit.manifest!.id, true) } });
}

async function removeDir(dir: string): Promise<void> {
  const r = await native.runCommand(IS_WINDOWS ? `Remove-Item -Recurse -Force ${sh(dir)}` : `rm -rf ${sh(dir)}`, null, 60);
  if (r.exit_code !== 0) throw new Error(r.stderr || "remove failed");
}

export async function uninstall(id: string, confirm = true): Promise<void> {
  const ext = byId(id) ?? useExtStore.getState().installed.find((x) => x.manifest?.id === id);
  if (!ext) return;
  if (confirm && !(await confirmPick(`Uninstall ${ext.manifest?.name ?? id}?`, "Uninstall", ext.dir))) return;
  await stop(id);
  const root = await extensionsRoot();
  if (!ext.dir.startsWith(`${root}/`)) throw new Error("Refusing to delete a folder outside the extensions directory");
  await removeDir(ext.dir);
  for (const k of [GRANTED_KEY(id), STORAGE_KEY(id), CONFIG_KEY(id)]) localStorage.removeItem(k);
  await setEnabled(id, false);
  await scan();
}

export const SAMPLE_MAIN = `// A Gear extension runs in a sandboxed worker. Everything it can do goes
// through \`gear\` — see the API list in the Extensions view (or README.md).

/** @param {any} gear */
exports.activate = async (gear) => {
  const update = async () => {
    const ed = await gear.editor.active();
    if (!ed) return gear.window.setStatus(null);
    const words = (ed.selection.text || ed.text).split(/\\s+/).filter(Boolean).length;
    await gear.window.setStatus(\`\${words} words\`, { tooltip: "Word count (click for details)", command: "__ID__.details" });
  };
  gear.events.on("activeEditorChange", update);
  gear.events.on("save", update);

  gear.commands.register("__ID__.details", async () => {
    const ed = await gear.editor.active();
    if (!ed) return gear.window.showWarning("Open a file first");
    const text = ed.selection.text || ed.text;
    const words = text.split(/\\s+/).filter(Boolean).length;
    const minutes = Math.max(1, Math.round(words / (await gear.config.get("__ID__.wordsPerMinute"))));
    const pick = await gear.window.showInformation(\`\${words} words · \${text.length} characters · ~\${minutes} min read\`, "Copy");
    if (pick === "Copy") console.log("(add the \\"clipboard\\" permission to copy)");
  });

  await update();
};

exports.deactivate = () => {};
`;

export async function createExtension(): Promise<void> {
  const name = await inputBox({ title: "New extension", placeholder: "word-count" });
  if (!name?.trim()) return;
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "my-extension";
  const id = `local.${slug}`;
  const root = await extensionsRoot();
  const dir = `${root}/${id}`;
  if ((await native.readFile(`${dir}/gear-extension.json`).catch(() => null))?.kind === "text") return void toast.error(`${dir} already exists`);
  await native.createDir(dir);
  const manifest = {
    id,
    name: name.trim(),
    version: "0.1.0",
    description: "Shows a word count in the status bar.",
    main: "main.js",
    permissions: ["editor.read"],
    activationEvents: ["onStartup"],
    contributes: {
      commands: [{ id: `${id}.details`, title: `${name.trim()}: Show details` }],
      configuration: { [`${id}.wordsPerMinute`]: { type: "number", default: 230, description: "Reading speed for the estimate" } },
    },
  };
  await native.writeFile(`${dir}/gear-extension.json`, `${JSON.stringify(manifest, null, 2)}\n`, "user");
  await native.writeFile(`${dir}/main.js`, SAMPLE_MAIN.replace(/__ID__/g, id), "user");
  await scan();
  await setEnabled(id, true);
  app().openFile(`${dir}/main.js`);
  toast.success(`Created ${id}`, { description: "Edit main.js, then “Reload” in the Extensions view." });
}

/** Wire editor events into the extension host (called once at startup). */
export function installEditorHooks(): () => void {
  const onSave = (e: Event) => emit("save", { path: (e as CustomEvent<{ path: string }>).detail.path }, "onSave");
  const onActive = (e: Event) => {
    const d = (e as CustomEvent<{ path?: string; languageId: string }>).detail;
    emit("activeEditorChange", { path: d.path ?? null, language: d.languageId }, `onLanguage:${d.languageId}`);
  };
  window.addEventListener("gear:file-saved", onSave);
  window.addEventListener("gear:active-editor", onActive);
  return () => {
    window.removeEventListener("gear:file-saved", onSave);
    window.removeEventListener("gear:active-editor", onActive);
  };
}
