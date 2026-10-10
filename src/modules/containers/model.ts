// Pure helpers for containers and dev containers: devcontainer.json (JSONC)
// parsing and variable substitution, turning a config into the docker
// command lines that build, create and set up the container, and parsers for
// the docker CLI's `--format '{{json .}}'` output.

export type LifecycleCommand = string | string[] | Record<string, string | string[]>;

export interface DevContainerConfig {
  name?: string;
  image?: string;
  build?: { dockerfile?: string; context?: string; args?: Record<string, string>; target?: string; options?: string[]; cacheFrom?: string | string[] };
  /** Legacy top-level spellings of build.dockerfile / build.context. */
  dockerFile?: string;
  context?: string;
  dockerComposeFile?: string | string[];
  service?: string;
  runServices?: string[];
  workspaceFolder?: string;
  workspaceMount?: string;
  mounts?: (string | { source?: string; target: string; type?: string })[];
  containerEnv?: Record<string, string>;
  remoteEnv?: Record<string, string | null>;
  containerUser?: string;
  remoteUser?: string;
  forwardPorts?: (number | string)[];
  appPort?: number | string | (number | string)[];
  portsAttributes?: Record<string, { label?: string; onAutoForward?: string }>;
  runArgs?: string[];
  overrideCommand?: boolean;
  privileged?: boolean;
  capAdd?: string[];
  securityOpt?: string[];
  init?: boolean;
  features?: Record<string, unknown>;
  shutdownAction?: "none" | "stopContainer" | "stopCompose";
  /** Linux hosts: give the remote user the local UID/GID so bind-mounted files stay writable (default true). */
  updateRemoteUserUID?: boolean;
  initializeCommand?: LifecycleCommand;
  onCreateCommand?: LifecycleCommand;
  updateContentCommand?: LifecycleCommand;
  postCreateCommand?: LifecycleCommand;
  postStartCommand?: LifecycleCommand;
  postAttachCommand?: LifecycleCommand;
}

// ── JSONC ─────────────────────────────────────────────────────────────────

/** Parse JSON with comments and trailing commas (devcontainer.json is JSONC). */
export function parseJsonc<T = unknown>(text: string): T {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      const start = i++;
      while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      out += text.slice(start, ++i);
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const e = text.indexOf("*/", i + 2);
      i = e < 0 ? text.length : e + 2;
    } else {
      out += c;
      i++;
    }
  }
  // Trailing commas: a comma followed only by whitespace before } or ].
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")) as T;
}

// ── paths and ids ─────────────────────────────────────────────────────────

export function basename(p: string): string {
  return p.replace(/[\\/]+$/, "").replace(/^.*[\\/]/, "");
}

export function dirname(p: string): string {
  const s = p.replace(/[\\/]+$/, "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i <= 0 ? (i === 0 ? s[0] : ".") : s.slice(0, i);
}

/** Join a path relative to `base` (absolute paths win), normalizing `.` and `..`. */
export function joinPath(base: string, rel: string): string {
  if (/^([A-Za-z]:[\\/]|[\\/])/.test(rel)) return rel;
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  const parts = `${base}${sep}${rel}`.split(/[\\/]+/);
  const out: string[] = [];
  for (const p of parts) {
    if (p === "." || (p === "" && out.length > 0)) continue;
    if (p === ".." && out.length > 1) out.pop();
    else out.push(p);
  }
  return out.join(sep) || sep;
}

/** A stable short hash (FNV-1a, 64-bit) as base-36. */
export function stableHash(s: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(36);
}

/** Docker wants a bind source in its own syntax: forward slashes, `/c/...` is not needed on Docker Desktop. */
export function dockerPath(p: string): string {
  return p.replace(/\\/g, "/");
}

// ── substitution ──────────────────────────────────────────────────────────

export interface SubstContext {
  localWorkspaceFolder: string;
  containerWorkspaceFolder: string;
  devcontainerId: string;
  localEnv: Record<string, string | undefined>;
  /** Only known after the container exists (for remoteEnv). */
  containerEnv?: Record<string, string>;
}

/** Expand ${localWorkspaceFolder}, ${localEnv:VAR[:default]}, ${containerEnv:VAR} … in every string. */
export function substitute<T>(value: T, ctx: SubstContext): T {
  const one = (s: string): string =>
    s.replace(/\$\{([^}:]+)(?::([^}:]*))?(?::([^}]*))?\}/g, (whole, key: string, arg?: string, def?: string) => {
      switch (key) {
        case "localWorkspaceFolder":
          return ctx.localWorkspaceFolder;
        case "localWorkspaceFolderBasename":
          return basename(ctx.localWorkspaceFolder);
        case "containerWorkspaceFolder":
          return ctx.containerWorkspaceFolder;
        case "containerWorkspaceFolderBasename":
          return basename(ctx.containerWorkspaceFolder);
        case "devcontainerId":
          return ctx.devcontainerId;
        case "localEnv":
        case "env":
          return (arg && ctx.localEnv[arg]) ?? def ?? "";
        case "containerEnv":
          if (!ctx.containerEnv) return whole;
          return (arg && ctx.containerEnv[arg]) ?? def ?? "";
        default:
          return whole;
      }
    });
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return one(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

// ── resolution ────────────────────────────────────────────────────────────

export interface ResolvedDevContainer {
  name: string;
  kind: "image" | "dockerfile" | "compose";
  configPath: string;
  localFolder: string;
  id: string;
  /** Image to run (built tag for dockerfile configs). */
  image: string;
  dockerfile?: string;
  context?: string;
  buildArgs: Record<string, string>;
  target?: string;
  buildOptions: string[];
  composeFiles: string[];
  composeProject: string;
  service?: string;
  runServices: string[];
  workspaceFolder: string;
  workspaceMount: string | null;
  mounts: string[];
  containerEnv: Record<string, string>;
  remoteEnv: Record<string, string | null>;
  containerUser?: string;
  remoteUser?: string;
  ports: number[];
  runArgs: string[];
  overrideCommand: boolean;
  features: string[];
  updateRemoteUserUID: boolean;
  lifecycle: Partial<Record<LifecyclePhase, LifecycleCommand>>;
  initializeCommand?: LifecycleCommand;
  configHash: string;
}

export type LifecyclePhase = "onCreateCommand" | "updateContentCommand" | "postCreateCommand" | "postStartCommand" | "postAttachCommand";
export const CREATE_PHASES: LifecyclePhase[] = ["onCreateCommand", "updateContentCommand", "postCreateCommand"];

function mountString(m: string | { source?: string; target: string; type?: string }): string {
  if (typeof m === "string") return m;
  return [`type=${m.type ?? "bind"}`, m.source ? `source=${m.source}` : null, `target=${m.target}`].filter(Boolean).join(",");
}

function portNumber(p: number | string): number | null {
  if (typeof p === "number") return p;
  const m = /^(?:[^:]+:)?(\d+)$/.exec(p.trim());
  return m ? Number(m[1]) : null;
}

/** Compose project names must be lowercase alphanumerics, `-` and `_`. */
export function composeProjectName(localFolder: string): string {
  return `${basename(localFolder)}_devcontainer`.toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

export function resolveDevContainer(raw: DevContainerConfig, configPath: string, localFolder: string, localEnv: Record<string, string | undefined> = {}): ResolvedDevContainer {
  const id = stableHash(`${dockerPath(localFolder)}\u0000${dockerPath(configPath)}`);
  const configDir = dirname(configPath);
  const compose = raw.dockerComposeFile !== undefined;
  const containerFolder = raw.workspaceFolder ?? (compose ? "/" : `/workspaces/${basename(localFolder)}`);
  const ctx: SubstContext = { localWorkspaceFolder: localFolder, containerWorkspaceFolder: containerFolder, devcontainerId: id, localEnv };
  const c = substitute(raw, ctx);
  const df = c.build?.dockerfile ?? c.dockerFile;
  const kind: ResolvedDevContainer["kind"] = compose ? "compose" : df ? "dockerfile" : "image";
  if (kind === "image" && !c.image) throw new Error("devcontainer.json needs an image, a build.dockerfile or a dockerComposeFile");
  if (kind === "compose" && !c.service) throw new Error("A Compose dev container needs a `service`");
  const dockerfile = df ? joinPath(configDir, df) : undefined;
  const context = df ? joinPath(configDir, c.build?.context ?? c.context ?? ".") : undefined;
  const ports = [...(c.forwardPorts ?? []), ...(c.appPort === undefined ? [] : Array.isArray(c.appPort) ? c.appPort : [c.appPort])].map(portNumber).filter((p): p is number => p !== null);
  const workspaceMount = compose ? null : (c.workspaceMount ?? `type=bind,source=${dockerPath(localFolder)},target=${containerFolder}`);
  const runArgs = [...(c.runArgs ?? [])];
  if (c.privileged) runArgs.push("--privileged");
  for (const cap of c.capAdd ?? []) runArgs.push("--cap-add", cap);
  for (const opt of c.securityOpt ?? []) runArgs.push("--security-opt", opt);
  if (c.init) runArgs.push("--init");
  const lifecycle: ResolvedDevContainer["lifecycle"] = {};
  for (const phase of [...CREATE_PHASES, "postStartCommand", "postAttachCommand"] as LifecyclePhase[]) if (c[phase] !== undefined) lifecycle[phase] = c[phase];
  const resolved: ResolvedDevContainer = {
    name: c.name ?? basename(localFolder),
    kind,
    configPath,
    localFolder,
    id,
    image: kind === "dockerfile" ? `gear-dev-${basename(localFolder).toLowerCase().replace(/[^a-z0-9_.-]/g, "")}-${id.slice(0, 8)}` : (c.image ?? ""),
    dockerfile,
    context,
    buildArgs: c.build?.args ?? {},
    target: c.build?.target,
    buildOptions: c.build?.options ?? [],
    composeFiles: compose ? (Array.isArray(c.dockerComposeFile) ? c.dockerComposeFile : [c.dockerComposeFile!]).map((f) => joinPath(configDir, f)) : [],
    composeProject: composeProjectName(localFolder),
    service: c.service,
    runServices: c.runServices ?? [],
    workspaceFolder: containerFolder,
    workspaceMount,
    mounts: (c.mounts ?? []).map(mountString),
    containerEnv: c.containerEnv ?? {},
    remoteEnv: c.remoteEnv ?? {},
    containerUser: c.containerUser,
    remoteUser: c.remoteUser ?? c.containerUser,
    ports: [...new Set(ports)],
    runArgs,
    overrideCommand: c.overrideCommand ?? !compose,
    features: Object.keys(c.features ?? {}),
    updateRemoteUserUID: c.updateRemoteUserUID ?? true,
    lifecycle,
    initializeCommand: c.initializeCommand,
    configHash: "",
  };
  // Everything that shapes the container itself; a change means "rebuild".
  resolved.configHash = stableHash(
    JSON.stringify([resolved.kind, resolved.image, c.build, resolved.composeFiles, resolved.service, resolved.workspaceMount, resolved.mounts, resolved.containerEnv, resolved.containerUser, resolved.ports, resolved.runArgs, resolved.overrideCommand, c.features]),
  );
  return resolved;
}

// ── command lines ─────────────────────────────────────────────────────────

/** Quote one argument for the host shell (POSIX sh, or PowerShell on Windows). */
export function quoteArg(a: string, windows: boolean): string {
  if (a === "") return windows ? "''" : "''";
  if (windows ? /^[A-Za-z0-9_\-./:=\\]+$/.test(a) : /^[A-Za-z0-9_\-.,/:=@%+]+$/.test(a)) return a;
  return windows ? `'${a.replace(/'/g, "''")}'` : `'${a.replace(/'/g, "'\\''")}'`;
}

export function commandLine(argv: string[], windows: boolean): string {
  return argv.map((a) => quoteArg(a, windows)).join(" ");
}

export const LABEL_FOLDER = "devcontainer.local_folder";
export const LABEL_CONFIG = "devcontainer.config_file";
export const LABEL_HASH = "gear.devcontainer.hash";

/** Keeps the container alive without the image's own command (overrideCommand). */
export const KEEP_ALIVE = "echo Container started; trap 'exit 0' TERM; while sleep 1 & wait $!; do :; done";

export function buildArgv(r: ResolvedDevContainer, noCache = false): string[] | null {
  if (r.kind !== "dockerfile") return null;
  const argv = ["docker", "build", "-f", dockerPath(r.dockerfile!), "-t", r.image];
  for (const [k, v] of Object.entries(r.buildArgs)) argv.push("--build-arg", `${k}=${v}`);
  if (r.target) argv.push("--target", r.target);
  if (noCache) argv.push("--no-cache");
  argv.push(...r.buildOptions, dockerPath(r.context!));
  return argv;
}

export function labels(r: ResolvedDevContainer): string[] {
  return [`${LABEL_FOLDER}=${dockerPath(r.localFolder)}`, `${LABEL_CONFIG}=${dockerPath(r.configPath)}`, `${LABEL_HASH}=${r.configHash}`];
}

export function runArgv(r: ResolvedDevContainer): string[] {
  const argv = ["docker", "run", "-d"];
  for (const l of labels(r)) argv.push("--label", l);
  if (r.workspaceMount) argv.push("--mount", r.workspaceMount);
  for (const m of r.mounts) argv.push("--mount", m);
  for (const [k, v] of Object.entries(r.containerEnv)) argv.push("-e", `${k}=${v}`);
  if (r.containerUser) argv.push("-u", r.containerUser);
  // Publish on loopback with a free host port; the panel shows the mapping.
  for (const p of r.ports) argv.push("-p", `127.0.0.1::${p}`);
  argv.push(...r.runArgs);
  if (r.overrideCommand) argv.push("--entrypoint", "/bin/sh", r.image, "-c", KEEP_ALIVE);
  else argv.push(r.image);
  return argv;
}

/** Compose files plus an override that labels the service and publishes ports. */
export function composeOverride(r: ResolvedDevContainer): string {
  const lines = ["services:", `  ${JSON.stringify(r.service)}:`, "    labels:"];
  for (const l of labels(r)) lines.push(`      - ${JSON.stringify(l)}`);
  if (Object.keys(r.containerEnv).length) {
    lines.push("    environment:");
    for (const [k, v] of Object.entries(r.containerEnv)) lines.push(`      ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  }
  if (r.mounts.length) {
    lines.push("    volumes:");
    for (const m of r.mounts) {
      const kv = Object.fromEntries(m.split(",").map((x) => x.split("=") as [string, string]));
      lines.push(`      - type: ${kv.type ?? "bind"}`);
      if (kv.source ?? kv.src) lines.push(`        source: ${JSON.stringify(kv.source ?? kv.src)}`);
      lines.push(`        target: ${JSON.stringify(kv.target ?? kv.dst ?? kv.destination)}`);
    }
  }
  if (r.ports.length) {
    lines.push("    ports:");
    for (const p of r.ports) lines.push(`      - "127.0.0.1::${p}"`);
  }
  if (r.overrideCommand) lines.push("    entrypoint: [\"/bin/sh\", \"-c\", " + JSON.stringify(KEEP_ALIVE) + "]", "    command: []");
  return `${lines.join("\n")}\n`;
}

export function composeArgv(r: ResolvedDevContainer, overrideFile: string, verb: "up" | "down" | "stop" | "build", noCache = false): string[] {
  const argv = ["docker", "compose", "-p", r.composeProject];
  for (const f of r.composeFiles) argv.push("-f", dockerPath(f));
  argv.push("-f", dockerPath(overrideFile));
  if (verb === "up") argv.push("up", "-d", "--build", ...(r.runServices.length ? [...new Set([r.service!, ...r.runServices])] : []));
  else if (verb === "build") argv.push("build", ...(noCache ? ["--no-cache"] : []), r.service!);
  else argv.push(verb);
  return argv;
}

export interface ExecOptions {
  user?: string;
  cwd?: string;
  env?: Record<string, string | null>;
  tty?: boolean;
}

export function execArgv(container: string, cmd: string[], o: ExecOptions = {}): string[] {
  const argv = ["docker", "exec"];
  if (o.tty) argv.push("-it");
  if (o.user) argv.push("-u", o.user);
  if (o.cwd) argv.push("-w", o.cwd);
  for (const [k, v] of Object.entries(o.env ?? {})) if (v !== null) argv.push("-e", `${k}=${v}`);
  argv.push(container, ...cmd);
  return argv;
}

/** One lifecycle command → the argv lists to run (object form runs its entries in parallel). */
export function lifecycleSteps(cmd: LifecycleCommand | undefined): { label: string | null; argv: string[] }[] {
  if (cmd === undefined || cmd === "" || (Array.isArray(cmd) && !cmd.length)) return [];
  if (typeof cmd === "string") return [{ label: null, argv: ["/bin/sh", "-c", cmd] }];
  if (Array.isArray(cmd)) return [{ label: null, argv: cmd }];
  return Object.entries(cmd).flatMap(([label, c]) => lifecycleSteps(c).map((s) => ({ ...s, label })));
}

/**
 * Run as root in the container: move `user` to the host's UID/GID (rewriting
 * /etc/passwd and /etc/group, then the home directory's ownership) so files
 * in the bind-mounted workspace are writable from both sides. Skips when the
 * ids already match or the UID belongs to someone else.
 */
export function updateUidScript(user: string, uid: number, gid: number): string {
  return [
    "set -e",
    `U=${quoteArg(user, false)}; NEW_UID=${uid}; NEW_GID=${gid}`,
    'OLD_UID=$(id -u "$U"); OLD_GID=$(id -g "$U")',
    '[ "$OLD_UID" = "$NEW_UID" ] && [ "$OLD_GID" = "$NEW_GID" ] && exit 0',
    'if awk -F: -v u="$NEW_UID" -v n="$U" \'$3==u && $1!=n {f=1} END {exit !f}\' /etc/passwd; then echo "UID $NEW_UID is taken in the container; leaving $U alone"; exit 0; fi',
    'HOME_DIR=$(awk -F: -v n="$U" \'$1==n {print $6}\' /etc/passwd)',
    'sed -i -E "s/^($U:[^:]*:)$OLD_UID:$OLD_GID:/\\1$NEW_UID:$NEW_GID:/" /etc/passwd',
    'if ! awk -F: -v g="$NEW_GID" \'$3==g {f=1} END {exit !f}\' /etc/group; then sed -i -E "s/^([^:]*:[^:]*:)$OLD_GID:/\\1$NEW_GID:/" /etc/group; fi',
    'if [ -n "$HOME_DIR" ] && [ -d "$HOME_DIR" ]; then chown -R "$NEW_UID:$NEW_GID" "$HOME_DIR"; fi',
    'echo "Updated $U to UID $NEW_UID"',
  ].join("\n");
}

/** The user to re-id, or null when there is nothing to do (root, unset, or disabled). */
export function uidUpdateTarget(r: ResolvedDevContainer, hostUid: number | null): string | null {
  const user = r.remoteUser ?? r.containerUser;
  if (!r.updateRemoteUserUID || hostUid === null || hostUid === 0 || !user || user === "root" || /^0(:|$)/.test(user)) return null;
  return user;
}

/** A login shell in the container: bash when present, else sh. */
export const SHELL_CMD = ["/bin/sh", "-c", "if command -v bash >/dev/null 2>&1; then exec bash -l; else exec sh -l; fi"];

// ── docker CLI output ─────────────────────────────────────────────────────

export interface PortMapping {
  hostIp: string;
  hostPort: number | null;
  containerPort: number;
  proto: string;
}

export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: PortMapping[];
  labels: Record<string, string>;
  createdAt: string;
  command: string;
}

/** `0.0.0.0:32768->3000/tcp, :::32768->3000/tcp, 5432/tcp` → mappings (IPv4/IPv6 duplicates merged). */
export function parsePorts(s: string): PortMapping[] {
  const out: PortMapping[] = [];
  for (const part of s.split(/,\s*/).filter(Boolean)) {
    const m = /^(?:(.*):(\d+)(?:-\d+)?->)?(\d+)(?:-\d+)?\/(\w+)$/.exec(part.trim());
    if (!m) continue;
    const p: PortMapping = { hostIp: m[1] ?? "", hostPort: m[2] ? Number(m[2]) : null, containerPort: Number(m[3]), proto: m[4] };
    if (!out.some((o) => o.hostPort === p.hostPort && o.containerPort === p.containerPort && o.proto === p.proto)) out.push(p);
  }
  return out;
}

export function parseLabels(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Values can contain commas; a new pair starts where `,key=` follows.
  for (const m of s.matchAll(/(?:^|,)([\w.\-/]+)=((?:(?!,[\w.\-/]+=).)*)/g)) out[m[1]] = m[2];
  return out;
}

function jsonLines<T>(stdout: string): T[] {
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l) as T);
}

export function parsePs(stdout: string): ContainerSummary[] {
  return jsonLines<Record<string, string>>(stdout).map((r) => ({
    id: r.ID,
    name: (r.Names ?? "").split(",")[0],
    image: r.Image,
    state: (r.State ?? "").toLowerCase(),
    status: r.Status ?? "",
    ports: parsePorts(r.Ports ?? ""),
    labels: parseLabels(r.Labels ?? ""),
    createdAt: r.CreatedAt ?? "",
    command: (r.Command ?? "").replace(/^"|"$/g, ""),
  }));
}

export interface ImageSummary {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

export function parseImages(stdout: string): ImageSummary[] {
  return jsonLines<Record<string, string>>(stdout).map((r) => ({ id: r.ID, repository: r.Repository, tag: r.Tag, size: r.Size, created: r.CreatedSince ?? r.CreatedAt ?? "" }));
}

export interface ContainerStats {
  id: string;
  cpu: number;
  memPercent: number;
  mem: string;
  net: string;
  block: string;
  pids: number;
}

export function parseStats(stdout: string): ContainerStats[] {
  const pct = (s: string | undefined) => Number((s ?? "0").replace("%", "")) || 0;
  return jsonLines<Record<string, string>>(stdout).map((r) => ({ id: r.ID ?? r.Container, cpu: pct(r.CPUPerc), memPercent: pct(r.MemPerc), mem: r.MemUsage ?? "", net: r.NetIO ?? "", block: r.BlockIO ?? "", pids: Number(r.PIDs) || 0 }));
}

export interface ComposeGroup {
  project: string | null;
  workingDir: string | null;
  containers: ContainerSummary[];
}

/** Group containers by Compose project (standalone containers last). */
export function groupByCompose(cs: ContainerSummary[]): ComposeGroup[] {
  const groups = new Map<string | null, ComposeGroup>();
  for (const c of cs) {
    const project = c.labels["com.docker.compose.project"] ?? null;
    let g = groups.get(project);
    if (!g) groups.set(project, (g = { project, workingDir: c.labels["com.docker.compose.project.working_dir"] ?? null, containers: [] }));
    g.containers.push(c);
  }
  return [...groups.values()].sort((a, b) => (a.project === null ? 1 : b.project === null ? -1 : a.project.localeCompare(b.project)));
}

// ── logs ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI, "");
}

export interface LogLine {
  time: string | null;
  text: string;
  level: "error" | "warn" | "info" | "debug" | null;
}

/** Split `docker logs --timestamps` output into lines with their timestamp and a guessed level. */
export function parseLogLines(chunk: string): LogLine[] {
  return stripAnsi(chunk)
    .split(/\r?\n/)
    .filter((l, i, a) => l !== "" || i < a.length - 1)
    .map((l) => {
      const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z) (.*)$/.exec(l);
      const text = m ? m[2] : l;
      const level = /\b(error|err|fatal|panic|exception)\b/i.test(text) ? "error" : /\bwarn(ing)?\b/i.test(text) ? "warn" : /\bdebug\b/i.test(text) ? "debug" : /\binfo\b/i.test(text) ? "info" : null;
      return { time: m ? m[1] : null, text, level };
    });
}

// ── templates ─────────────────────────────────────────────────────────────

export interface Template {
  id: string;
  label: string;
  config: DevContainerConfig;
}

export const TEMPLATES: Template[] = [
  { id: "node", label: "Node.js & TypeScript", config: { name: "Node.js", image: "mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm", forwardPorts: [3000], postCreateCommand: "npm install", remoteUser: "node" } },
  { id: "python", label: "Python 3", config: { name: "Python 3", image: "mcr.microsoft.com/devcontainers/python:1-3.12-bookworm", postCreateCommand: "pip3 install --user -r requirements.txt", remoteUser: "vscode" } },
  { id: "go", label: "Go", config: { name: "Go", image: "mcr.microsoft.com/devcontainers/go:1-1.23-bookworm", postCreateCommand: "go mod download", remoteUser: "vscode" } },
  { id: "rust", label: "Rust", config: { name: "Rust", image: "mcr.microsoft.com/devcontainers/rust:1-1-bookworm", postCreateCommand: "cargo fetch", remoteUser: "vscode" } },
  { id: "java", label: "Java", config: { name: "Java", image: "mcr.microsoft.com/devcontainers/java:1-21-bookworm", remoteUser: "vscode" } },
  { id: "dockerfile", label: "From a Dockerfile in .devcontainer/", config: { name: "Dev", build: { dockerfile: "Dockerfile", context: ".." } } },
  { id: "base", label: "Debian (base)", config: { name: "Debian", image: "mcr.microsoft.com/devcontainers/base:bookworm", remoteUser: "vscode" } },
];

/** Pick a template from the files at the workspace root. */
export function suggestTemplate(files: string[]): Template {
  const has = (re: RegExp) => files.some((f) => re.test(f));
  const id = has(/^package\.json$/) ? "node" : has(/^(pyproject\.toml|requirements\.txt|setup\.py|Pipfile)$/) ? "python" : has(/^go\.mod$/) ? "go" : has(/^Cargo\.toml$/) ? "rust" : has(/^(pom\.xml|build\.gradle(\.kts)?)$/) ? "java" : "base";
  return TEMPLATES.find((t) => t.id === id)!;
}

export function templateFile(t: Template, files: string[]): string {
  const config = { ...t.config };
  // Only run the install step when the file it needs exists.
  if (t.id === "python" && !files.includes("requirements.txt")) delete config.postCreateCommand;
  if (t.id === "node" && files.includes("pnpm-lock.yaml")) config.postCreateCommand = "corepack enable && pnpm install";
  if (t.id === "node" && files.includes("yarn.lock")) config.postCreateCommand = "corepack enable && yarn install";
  return `// Dev container for this project — see https://containers.dev/implementors/json_reference/\n${JSON.stringify(config, null, 2)}\n`;
}

export interface AnsiSpan {
  text: string;
  fg: number | null;
  bold: boolean;
}

/** Split text on SGR escapes into styled spans (16 colours + bold; everything else dropped). */
export function ansiSpans(s: string): AnsiSpan[] {
  const out: AnsiSpan[] = [];
  let fg: number | null = null;
  let bold = false;
  let last = 0;
  // eslint-disable-next-line no-control-regex
  const re = /\x1b\[([0-9;]*)m|\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g;
  const push = (text: string) => {
    if (!text) return;
    const prev = out[out.length - 1];
    if (prev && prev.fg === fg && prev.bold === bold) prev.text += text;
    else out.push({ text, fg, bold });
  };
  for (const m of s.matchAll(re)) {
    push(s.slice(last, m.index));
    last = m.index! + m[0].length;
    if (m[1] === undefined) continue;
    const codes = m[1] === "" ? [0] : m[1].split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) [fg, bold] = [null, false];
      else if (c === 1) bold = true;
      else if (c === 22) bold = false;
      else if (c === 39) fg = null;
      else if (c >= 30 && c <= 37) fg = c - 30;
      else if (c >= 90 && c <= 97) fg = c - 90 + 8;
      else if (c === 38 || c === 48) i += codes[i + 1] === 5 ? 2 : 4; // skip 256/truecolor
    }
  }
  push(s.slice(last));
  return out;
}
