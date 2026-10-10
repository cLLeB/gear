// Containers runtime: docker CLI calls, the container / image lists the panel
// shows, streamed steps (build, pull, compose up, lifecycle commands) logged
// to the "Dev Container" tab, and the dev container lifecycle itself:
// find → (re)build → create → re-id the user → lifecycle → attach.

import { appCacheDir } from "@tauri-apps/api/path";
import { toast } from "sonner";
import { create } from "zustand";
import { app } from "@/app/appBridge";
import { IS_LINUX, IS_WINDOWS } from "@/lib/platform";
import { native } from "@/modules/ai/lib/native";
import { confirmPick, quickPick } from "@/modules/quick-pick";
import {
  buildArgv,
  commandLine,
  composeArgv,
  composeOverride,
  CREATE_PHASES,
  dirname,
  execArgv,
  LABEL_CONFIG,
  LABEL_FOLDER,
  LABEL_HASH,
  lifecycleSteps,
  parseImages,
  parseJsonc,
  parsePs,
  parseStats,
  resolveDevContainer,
  runArgv,
  SHELL_CMD,
  substitute,
  uidUpdateTarget,
  updateUidScript,
  type ContainerStats,
  type ContainerSummary,
  type DevContainerConfig,
  type ImageSummary,
  type LifecycleCommand,
  type ResolvedDevContainer,
} from "./model";

export interface DevState {
  phase: "idle" | "starting" | "running" | "stopped" | "error";
  configPath: string | null;
  resolved: ResolvedDevContainer | null;
  containerId: string | null;
  /** remoteEnv with ${containerEnv:…} expanded. */
  env: Record<string, string | null>;
  error: string | null;
}

interface ContainersStore {
  available: boolean | null;
  version: string | null;
  containers: ContainerSummary[];
  images: ImageSummary[];
  stats: Record<string, ContainerStats>;
  dev: DevState;
  log: string;
  logRunning: boolean;
}

const NO_DEV: DevState = { phase: "idle", configPath: null, resolved: null, containerId: null, env: {}, error: null };

export const useContainersStore = create<ContainersStore>(() => ({ available: null, version: null, containers: [], images: [], stats: {}, dev: NO_DEV, log: "", logRunning: false }));

export const LOG_PATH = "gear-docker://Dev Container";
export const logsPath = (c: { id: string; name: string }) => `gear-docker://logs/${c.id}/${c.name}`;
export const inspectPath = (c: { id: string; name: string }) => `gear-docker://inspect/${c.id}/${c.name}`;

export function parseDockerPath(path: string): { kind: "log" } | { kind: "logs" | "inspect"; id: string; name: string } | null {
  if (path === LOG_PATH) return { kind: "log" };
  const m = /^gear-docker:\/\/(logs|inspect)\/([^/]+)\/(.*)$/.exec(path);
  return m ? { kind: m[1] as "logs" | "inspect", id: m[2], name: m[3] } : null;
}

const line = (argv: string[]) => commandLine(argv, IS_WINDOWS);

/** Run a docker command and return stdout; throws with stderr on failure. */
export async function docker(argv: string[], timeoutSecs = 60, cwd?: string | null): Promise<string> {
  const r = await native.runCommand(line(argv), cwd ?? null, timeoutSecs);
  if (r.exit_code !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.exit_code}`).trim());
  return r.stdout;
}

// ── lists ─────────────────────────────────────────────────────────────────

export async function detect(): Promise<boolean> {
  try {
    const v = (await docker(["docker", "version", "--format", "{{.Server.Version}}"], 15)).trim();
    useContainersStore.setState({ available: true, version: v });
    return true;
  } catch (e) {
    useContainersStore.setState({ available: false, version: String(e).split("\n")[0] });
    return false;
  }
}

export async function refresh(): Promise<void> {
  if (useContainersStore.getState().available === null && !(await detect())) return;
  try {
    const [ps, images] = await Promise.all([docker(["docker", "ps", "-a", "--no-trunc", "--format", "{{json .}}"]), docker(["docker", "images", "--format", "{{json .}}"])]);
    useContainersStore.setState({ containers: parsePs(ps), images: parseImages(images), available: true });
    syncDevState();
  } catch (e) {
    useContainersStore.setState({ available: false, version: String(e).split("\n")[0] });
  }
}

export async function refreshStats(): Promise<void> {
  const running = useContainersStore.getState().containers.filter((c) => c.state === "running");
  if (!running.length) return void useContainersStore.setState({ stats: {} });
  const out = await docker(["docker", "stats", "--no-stream", "--format", "{{json .}}"], 30).catch(() => "");
  const stats: Record<string, ContainerStats> = {};
  for (const s of parseStats(out)) {
    const c = running.find((x) => x.id.startsWith(s.id));
    if (c) stats[c.id] = s;
  }
  useContainersStore.setState({ stats });
}

/** Keep the dev container state in step with what docker reports. */
function syncDevState(): void {
  const { dev, containers } = useContainersStore.getState();
  if (!dev.resolved || dev.phase === "starting") return;
  const c = findDevContainer(containers, dev.resolved);
  const phase = !c ? "idle" : c.state === "running" ? "running" : "stopped";
  if (phase !== dev.phase || c?.id !== dev.containerId) useContainersStore.setState({ dev: { ...dev, phase, containerId: c?.id ?? null } });
}

export function findDevContainer(cs: ContainerSummary[], r: ResolvedDevContainer): ContainerSummary | undefined {
  const folder = r.localFolder.replace(/\\/g, "/");
  const mine = cs.filter((c) => c.labels[LABEL_FOLDER] === folder && (!c.labels[LABEL_CONFIG] || c.labels[LABEL_CONFIG] === r.configPath.replace(/\\/g, "/")));
  return r.kind === "compose" ? mine.find((c) => c.labels["com.docker.compose.service"] === r.service) : mine[0];
}

export async function containerAction(c: ContainerSummary, verb: "start" | "stop" | "restart" | "pause" | "unpause" | "rm"): Promise<void> {
  try {
    await docker(verb === "rm" ? ["docker", "rm", "-f", c.id] : ["docker", verb, c.id], 120);
  } catch (e) {
    toast.error(`docker ${verb} failed`, { description: String(e) });
  }
  await refresh();
}

export async function composeAction(project: string, workingDir: string | null, verb: "start" | "stop" | "restart" | "down"): Promise<void> {
  try {
    await docker(["docker", "compose", "-p", project, verb], 300, workingDir);
  } catch (e) {
    toast.error(`docker compose ${verb} failed`, { description: String(e) });
  }
  await refresh();
}

export async function removeImage(img: ImageSummary): Promise<void> {
  try {
    await docker(["docker", "rmi", img.repository === "<none>" ? img.id : `${img.repository}:${img.tag}`], 120);
  } catch (e) {
    toast.error("Couldn't remove the image", { description: String(e) });
  }
  await refresh();
}

export async function prune(): Promise<void> {
  const what = await quickPick(
    [
      { label: "Stopped containers", value: ["container", "prune", "-f"], detail: "docker container prune" },
      { label: "Dangling images", value: ["image", "prune", "-f"], detail: "docker image prune" },
      { label: "Unused volumes", value: ["volume", "prune", "-f"], detail: "docker volume prune — deletes data" },
      { label: "Build cache", value: ["builder", "prune", "-f"], detail: "docker builder prune" },
    ],
    { title: "Prune" },
  );
  if (!what) return;
  try {
    const out = await docker(["docker", ...what], 600);
    toast.success(out.trim().split("\n").pop() || "Pruned");
  } catch (e) {
    toast.error("Prune failed", { description: String(e) });
  }
  await refresh();
}

/** An interactive shell in a container, in a new terminal tab. */
export function openShell(c: { id: string }, o: { user?: string; cwd?: string; env?: Record<string, string | null> } = {}): void {
  app().openTerminal({ command: line(execArgv(c.id, SHELL_CMD, { ...o, tty: true })) });
}

// ── streamed steps ────────────────────────────────────────────────────────

function appendLog(text: string): void {
  useContainersStore.setState((s) => ({ log: (s.log + text).slice(-400_000) }));
}

function heading(text: string): void {
  appendLog(`\n\u001b[1m▸ ${text}\u001b[0m\n`);
}

/** Run a command in the background, streaming its output into the dev container log. */
async function step(label: string, cmd: string, cwd?: string | null): Promise<void> {
  heading(label);
  appendLog(`$ ${cmd}\n`);
  const handle = await native.shellBgSpawn(cmd, cwd ?? null);
  let offset = 0;
  for (;;) {
    const r = await native.shellBgLogs(handle, offset);
    if (r.bytes) appendLog(r.bytes);
    offset = r.next_offset;
    if (r.exited) {
      if (r.exit_code !== 0) throw new Error(`${label} failed (exit ${r.exit_code})`);
      return;
    }
    await new Promise((res) => setTimeout(res, 200));
  }
}

// ── dev containers ────────────────────────────────────────────────────────

export async function findConfigs(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const rel of [".devcontainer/devcontainer.json", ".devcontainer.json"]) {
    const r = await native.readFile(`${root}/${rel}`).catch(() => null);
    if (r?.kind === "text") out.push(`${root}/${rel}`);
  }
  // Named configurations: .devcontainer/<name>/devcontainer.json
  const dirs = await native.readDir(`${root}/.devcontainer`).catch(() => []);
  for (const d of dirs.filter((e) => e.kind === "dir")) {
    const p = `${root}/.devcontainer/${d.name}/devcontainer.json`;
    if ((await native.readFile(p).catch(() => null))?.kind === "text") out.push(p);
  }
  return out;
}

async function pickConfig(root: string): Promise<string | null> {
  const all = await findConfigs(root);
  if (all.length <= 1) return all[0] ?? null;
  const last = useContainersStore.getState().dev.configPath;
  if (last && all.includes(last)) return last;
  return (await quickPick(all.map((p) => ({ label: p.slice(root.length + 1), value: p })), { title: "Dev container configuration" })) ?? null;
}

/** Host environment variables a config refers to via ${localEnv:…}. */
async function localEnv(text: string): Promise<Record<string, string>> {
  const names = [...new Set([...text.matchAll(/\$\{(?:localEnv|env):(\w+)/g)].map((m) => m[1]))];
  if (!names.length) return {};
  const cmd = IS_WINDOWS ? names.map((n) => `Write-Output ("${n}=" + $env:${n})`).join("; ") : names.map((n) => `printf '%s=%s\\n' ${n} "\${${n}-}"`).join("; ");
  const r = await native.runCommand(cmd, null, 10).catch(() => null);
  const env: Record<string, string> = {};
  for (const l of (r?.stdout ?? "").split(/\r?\n/)) {
    const i = l.indexOf("=");
    if (i > 0 && l.slice(i + 1)) env[l.slice(0, i)] = l.slice(i + 1);
  }
  return env;
}

async function loadConfig(path: string, root: string): Promise<ResolvedDevContainer> {
  const r = await native.readFile(path);
  if (r.kind !== "text") throw new Error(`Can't read ${path}`);
  const raw = parseJsonc<DevContainerConfig>(r.content);
  return resolveDevContainer(raw, path, root, await localEnv(r.content));
}

function hostCommand(cmd: LifecycleCommand): string[] {
  if (typeof cmd === "string") return [cmd];
  if (Array.isArray(cmd)) return [line(cmd)];
  return Object.values(cmd).flatMap(hostCommand);
}

async function hasDevcontainerCli(): Promise<boolean> {
  const r = await native.runCommand("devcontainer --version", null, 15).catch(() => null);
  return r?.exit_code === 0;
}

async function containerEnv(id: string): Promise<Record<string, string>> {
  const out = await docker(["docker", "inspect", "--format", "{{json .Config.Env}}", id]).catch(() => "[]");
  const env: Record<string, string> = {};
  for (const kv of JSON.parse(out.trim() || "[]") as string[]) {
    const i = kv.indexOf("=");
    if (i > 0) env[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return env;
}

async function runLifecycle(r: ResolvedDevContainer, id: string, phases: string[], env: Record<string, string | null>): Promise<void> {
  for (const phase of phases) {
    const steps = lifecycleSteps(r.lifecycle[phase as keyof typeof r.lifecycle]);
    // Object-form commands run in parallel, like the reference implementation.
    await Promise.all(steps.map((s) => step(`${phase}${s.label ? ` (${s.label})` : ""}`, line(execArgv(id, s.argv, { user: r.remoteUser, cwd: r.workspaceFolder, env })))));
  }
}

async function overrideFile(r: ResolvedDevContainer): Promise<string> {
  const dir = `${(await appCacheDir()).replace(/\\/g, "/").replace(/\/+$/, "")}/devcontainers/${r.id}`;
  await native.createDir(dir).catch(() => {});
  const path = `${dir}/docker-compose.override.yml`;
  await native.writeFile(path, composeOverride(r), "user");
  return path;
}

function setDev(patch: Partial<DevState>): void {
  useContainersStore.setState((s) => ({ dev: { ...s.dev, ...patch } }));
}

async function hostIds(): Promise<{ uid: number; gid: number } | null> {
  if (!IS_LINUX) return null;
  const r = await native.runCommand("id -u; id -g", null, 10).catch(() => null);
  const [uid, gid] = (r?.stdout ?? "").trim().split(/\s+/).map(Number);
  return Number.isFinite(uid) && Number.isFinite(gid) ? { uid, gid } : null;
}

/**
 * Start the workspace's dev container: reuse a running one, start a stopped
 * one, or build and create it (rebuild: remove the old one first).
 */
export async function devUp(opts: { rebuild?: boolean; noCache?: boolean } = {}): Promise<void> {
  const root = app().workspaceRoot();
  if (!root) return void toast.error("Open a folder first");
  const configPath = await pickConfig(root);
  if (!configPath) {
    toast.info("No dev container configuration", { description: "Add one with “Dev Containers: Add Configuration”.", action: { label: "Add", onClick: () => void addConfig() } });
    return;
  }
  if (!(await detect())) return void toast.error("Docker isn't reachable", { description: useContainersStore.getState().version ?? "" });
  let r: ResolvedDevContainer;
  try {
    r = await loadConfig(configPath, root);
  } catch (e) {
    setDev({ phase: "error", configPath, error: String(e) });
    return void toast.error("Invalid devcontainer.json", { description: String(e) });
  }
  useContainersStore.setState({ log: "", logRunning: true });
  setDev({ phase: "starting", configPath, resolved: r, error: null });
  app().openFile(LOG_PATH);
  try {
    await refresh();
    let existing = findDevContainer(useContainersStore.getState().containers, r);
    const stale = existing && existing.labels[LABEL_HASH] && existing.labels[LABEL_HASH] !== r.configHash;
    if (existing && (opts.rebuild || (stale && (await confirmPick("devcontainer.json changed since the container was created", "Rebuild the container", "Keep using the existing one otherwise"))))) {
      heading("Removing the old container");
      if (r.kind === "compose") await step("docker compose down", line(composeArgv(r, await overrideFile(r), "down")));
      else await docker(["docker", "rm", "-f", existing.id], 120);
      existing = undefined;
    }
    let id: string;
    let created = false;
    let viaCli = false;
    if (existing) {
      id = existing.id;
      if (existing.state !== "running") {
        if (r.kind === "compose") await step("docker compose up", line(composeArgv(r, await overrideFile(r), "up")), dirname(r.composeFiles[0]));
        else await step("docker start", line(["docker", "start", id]));
      } else heading("Reusing the running container");
    } else if (r.features.length && (await hasDevcontainerCli())) {
      // Features need the OCI feature installer; the reference CLI does it all.
      const args = ["devcontainer", "up", "--workspace-folder", r.localFolder, "--config", configPath, "--id-label", `${LABEL_FOLDER}=${r.localFolder.replace(/\\/g, "/")}`, "--id-label", `${LABEL_CONFIG}=${configPath.replace(/\\/g, "/")}`];
      if (opts.noCache) args.push("--build-no-cache");
      await step("devcontainer up (features)", line(args));
      await refresh();
      const c = findDevContainer(useContainersStore.getState().containers, r);
      if (!c) throw new Error("devcontainer up finished but the container wasn't found");
      id = c.id;
      viaCli = true; // the CLI already ran the lifecycle commands
    } else {
      if (r.features.length) toast.warning(`Skipping ${r.features.length} dev container feature(s)`, { description: "Install the devcontainer CLI (npm i -g @devcontainers/cli) to apply features." });
      if (r.initializeCommand) for (const c of hostCommand(r.initializeCommand)) await step("initializeCommand (host)", c, r.localFolder);
      if (r.kind === "compose") {
        await step("docker compose up", line(composeArgv(r, await overrideFile(r), "up")), dirname(r.composeFiles[0]));
        await refresh();
        const c = findDevContainer(useContainersStore.getState().containers, r);
        if (!c) throw new Error(`Compose started but service “${r.service}” isn't running`);
        id = c.id;
      } else {
        const build = buildArgv(r, opts.noCache);
        if (build) await step("Build image", line(build));
        else await step("Pull image", line(["docker", "pull", r.image])).catch(() => appendLog("(pull failed — trying the local image)\n"));
        heading("Create container");
        id = (await docker(runArgv(r), 300)).trim().split(/\s+/).pop()!;
        appendLog(`${id}\n`);
      }
      created = true;
    }
    const ids = created ? await hostIds() : null;
    const target = ids ? uidUpdateTarget(r, ids.uid) : null;
    if (ids && target) await step(`Match ${target}'s UID to the host`, line(execArgv(id, ["/bin/sh", "-c", updateUidScript(target, ids.uid, ids.gid)], { user: "root" })));
    const env = substitute(r.remoteEnv, { localWorkspaceFolder: r.localFolder, containerWorkspaceFolder: r.workspaceFolder, devcontainerId: r.id, localEnv: {}, containerEnv: await containerEnv(id) });
    setDev({ containerId: id, env });
    if (!viaCli) await runLifecycle(r, id, [...(created ? CREATE_PHASES : []), ...(existing?.state === "running" ? [] : ["postStartCommand"]), "postAttachCommand"], env);
    heading("Ready");
    setDev({ phase: "running" });
    await refresh();
    const c = useContainersStore.getState().containers.find((x) => x.id === id);
    const ports = c?.ports.filter((p) => p.hostPort) ?? [];
    toast.success(`Dev container “${r.name}” is running`, {
      description: ports.length ? ports.map((p) => `${p.containerPort} → localhost:${p.hostPort}`).join(", ") : undefined,
      action: { label: "Open terminal", onClick: () => devShell() },
    });
  } catch (e) {
    appendLog(`\n\u001b[31m${String(e)}\u001b[0m\n`);
    setDev({ phase: "error", error: String(e) });
    toast.error("Dev container failed to start", { description: String(e), action: { label: "Show log", onClick: () => app().openFile(LOG_PATH) } });
  } finally {
    useContainersStore.setState({ logRunning: false });
  }
}

/** Load the config and look for its container without starting anything. */
export async function devProbe(): Promise<void> {
  const root = app().workspaceRoot();
  if (!root) return;
  const configs = await findConfigs(root).catch(() => []);
  if (!configs.length) return void setDev(NO_DEV);
  const configPath = useContainersStore.getState().dev.configPath ?? configs[0];
  try {
    const r = await loadConfig(configPath, root);
    setDev({ configPath, resolved: r, error: null });
    syncDevState();
  } catch (e) {
    setDev({ configPath, phase: "error", error: String(e) });
  }
}

async function devContainerOrWarn(): Promise<{ r: ResolvedDevContainer; c: ContainerSummary } | null> {
  await devProbe();
  await refresh();
  const { resolved } = useContainersStore.getState().dev;
  const c = resolved ? findDevContainer(useContainersStore.getState().containers, resolved) : undefined;
  if (!resolved || !c) {
    toast.info("The dev container isn't created yet", { action: { label: "Start it", onClick: () => void devUp() } });
    return null;
  }
  return { r: resolved, c };
}

export async function devShell(): Promise<void> {
  const hit = await devContainerOrWarn();
  if (!hit) return;
  if (hit.c.state !== "running") await devUp();
  openShell(hit.c, { user: hit.r.remoteUser, cwd: hit.r.workspaceFolder, env: useContainersStore.getState().dev.env });
}

/** Run a command line inside the dev container, in a terminal. */
export async function devRun(command: string): Promise<void> {
  const hit = await devContainerOrWarn();
  if (!hit) return;
  app().openTerminal({ command: line(execArgv(hit.c.id, ["/bin/sh", "-lc", command], { tty: true, user: hit.r.remoteUser, cwd: hit.r.workspaceFolder, env: useContainersStore.getState().dev.env })) });
}

export async function devStop(remove = false): Promise<void> {
  const hit = await devContainerOrWarn();
  if (!hit) return;
  if (remove && !(await confirmPick(`Remove the dev container “${hit.r.name}”?`, "Remove", "Files in the workspace stay; anything else inside the container is lost."))) return;
  try {
    if (hit.r.kind === "compose") await docker(composeArgv(hit.r, await overrideFile(hit.r), remove ? "down" : "stop"), 300, dirname(hit.r.composeFiles[0]));
    else await docker(remove ? ["docker", "rm", "-f", hit.c.id] : ["docker", "stop", hit.c.id], 120);
  } catch (e) {
    toast.error("Failed", { description: String(e) });
  }
  await refresh();
}

export async function addConfig(): Promise<void> {
  const root = app().workspaceRoot();
  if (!root) return void toast.error("Open a folder first");
  const { suggestTemplate, templateFile, TEMPLATES } = await import("./model");
  const files = (await native.readDir(root).catch(() => [])).map((e) => e.name);
  const suggested = suggestTemplate(files);
  const t = await quickPick(
    [suggested, ...TEMPLATES.filter((x) => x !== suggested)].map((x, i) => ({ label: x.label, description: i === 0 ? "suggested" : undefined, detail: x.config.image ?? "Dockerfile", value: x })),
    { title: "Dev container template" },
  );
  if (!t) return;
  const path = `${root}/.devcontainer/devcontainer.json`;
  if ((await native.readFile(path).catch(() => null))?.kind === "text" && !(await confirmPick(".devcontainer/devcontainer.json exists", "Overwrite it"))) return;
  await native.createDir(`${root}/.devcontainer`).catch(() => {});
  await native.writeFile(path, templateFile(t, files), "user");
  if (t.id === "dockerfile" && (await native.readFile(`${root}/.devcontainer/Dockerfile`).catch(() => null))?.kind !== "text") {
    await native.writeFile(`${root}/.devcontainer/Dockerfile`, "FROM mcr.microsoft.com/devcontainers/base:bookworm\n\n# RUN apt-get update && apt-get install -y --no-install-recommends <packages>\n", "user");
  }
  app().openFile(path);
  void devProbe();
}
