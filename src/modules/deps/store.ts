// Dependency manager: finds the workspace's projects (npm / pnpm / yarn,
// Cargo, Python, Go), asks each tool what's outdated, looks up latest versions
// and known vulnerabilities, and runs upgrades (one, or every safe one).

import { appCacheDir } from "@tauri-apps/api/path";
import { toast } from "sonner";
import { create } from "zustand";
import { app } from "@/app/appBridge";
import { IS_WINDOWS } from "@/lib/platform";
import { native } from "@/modules/ai/lib/native";
import { commandLine } from "@/modules/containers/model";
import { pythonFor } from "@/modules/debug/store";
import { confirmPick } from "@/modules/quick-pick";
import {
  applyCratesInfo,
  bumpRequirement,
  osvQuery,
  parseCargoMetadata,
  parseGoList,
  parseNpmAudit,
  parseNpmOutdated,
  parseOsvBatch,
  parsePipOutdated,
  parsePnpmAudit,
  parsePnpmOutdated,
  parsePypiVulns,
  pythonDirectNames,
  updateKind,
  upgradeArgv,
  type Dep,
  type Ecosystem,
  type Vuln,
} from "./model";

export interface Project {
  dir: string;
  eco: Ecosystem;
  label: string;
  status: "idle" | "scanning" | "ready" | "error";
  deps: Dep[];
  error?: string;
  /** Advisory lookup didn't work (offline, tool missing…). */
  auditError?: string;
  scannedAt?: number;
}

interface DepsStore {
  root: string | null;
  projects: Project[];
  busy: Record<string, boolean>;
  log: string;
}

export const useDepsStore = create<DepsStore>(() => ({ root: null, projects: [], busy: {}, log: "" }));
export const DEPS_PATH = "gear-deps://Dependencies";

const line = (argv: string[]) => commandLine(argv, IS_WINDOWS);
const CURL = IS_WINDOWS ? "curl.exe" : "curl";
const UA = "gear-editor (https://github.com/cLLeB/gear)";

async function run(argv: string[], cwd: string, timeout = 180): Promise<{ out: string; err: string; code: number | null }> {
  const r = await native.runCommand(line(argv), cwd, timeout);
  return { out: r.stdout, err: r.stderr, code: r.exit_code };
}

async function readText(p: string): Promise<string | null> {
  const r = await native.readFile(p).catch(() => null);
  return r?.kind === "text" ? r.content : null;
}

function setProject(dir: string, patch: Partial<Project>): void {
  useDepsStore.setState((s) => ({ projects: s.projects.map((p) => (p.dir === dir ? { ...p, ...patch } : p)) }));
}

/** Run `fn` over items with at most `n` in flight. */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

// ── discovery ─────────────────────────────────────────────────────────────

const SKIP = /(^|\/)(node_modules|target|vendor|\.venv|venv|env|dist|build|\.git)(\/|$)/;

export async function discover(): Promise<Project[]> {
  const root = app().workspaceRoot()?.replace(/\\/g, "/") ?? null;
  if (!root) {
    useDepsStore.setState({ root: null, projects: [] });
    return [];
  }
  const hits = await native.glob({ pattern: "**/{package.json,Cargo.toml,go.mod,pyproject.toml,requirements.txt}", root, maxResults: 400 }).catch(() => ({ hits: [] as { path: string; rel: string }[], truncated: false }));
  const files = hits.hits.map((h) => h.rel.replace(/\\/g, "/")).filter((r) => !SKIP.test(r) && r.split("/").length <= 4);
  const dirOf = (r: string) => (r.includes("/") ? r.slice(0, r.lastIndexOf("/")) : "");
  const has = (dir: string, name: string) => files.includes(dir ? `${dir}/${name}` : name);
  const projects: Project[] = [];
  const seen = new Set<string>();
  for (const f of files.sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))) {
    const d = dirOf(f);
    const name = f.split("/").pop()!;
    const abs = d ? `${root}/${d}` : root;
    const label = d || root.split("/").pop() || root;
    if (name === "package.json") {
      const pkg = await readText(`${abs}/package.json`);
      if (!pkg || !/"(dev|optional)?[dD]ependencies"\s*:\s*\{\s*"/.test(pkg)) continue;
      const lock = await Promise.all(["pnpm-lock.yaml", "yarn.lock"].map((l) => readText(`${abs}/${l}`)));
      const eco: Ecosystem = lock[0] !== null ? "pnpm" : lock[1] !== null ? "yarn" : "npm";
      // Workspace packages share their root's install (no lockfile of their own): list the root only.
      const npmLock = await readText(`${abs}/package-lock.json`);
      if (lock.every((l) => l === null) && npmLock === null && projects.some((x) => (x.eco === "npm" || x.eco === "pnpm" || x.eco === "yarn") && abs.startsWith(`${x.dir}/`))) continue;
      projects.push({ dir: abs, eco, label: `${label} (${eco})`, status: "idle", deps: [] });
    } else if (name === "Cargo.toml") {
      // Members are covered by their workspace root.
      if ([...seen].some((s) => s.startsWith("cargo:") && (s === "cargo:" || d.startsWith(`${s.slice(6)}/`)))) continue;
      seen.add(`cargo:${d}`);
      projects.push({ dir: abs, eco: "cargo", label: `${label} (cargo)`, status: "idle", deps: [] });
    } else if (name === "go.mod") {
      projects.push({ dir: abs, eco: "go", label: `${label} (go)`, status: "idle", deps: [] });
    } else if ((name === "pyproject.toml" || name === "requirements.txt") && !seen.has(`py:${d}`)) {
      if (name === "pyproject.toml" && has(d, "Cargo.toml")) continue; // maturin crates
      seen.add(`py:${d}`);
      projects.push({ dir: abs, eco: "pip", label: `${label} (python)`, status: "idle", deps: [] });
    }
  }
  const prev = useDepsStore.getState().projects;
  useDepsStore.setState({ root, projects: projects.map((p) => prev.find((x) => x.dir === p.dir && x.eco === p.eco) ?? p) });
  return projects;
}

// ── scanning ──────────────────────────────────────────────────────────────

async function scanNode(p: Project): Promise<{ deps: Dep[]; vulns: Record<string, Vuln[]> | null; auditError?: string }> {
  const outdated = await run(p.eco === "pnpm" ? ["pnpm", "outdated", "--format", "json"] : ["npm", "outdated", "--json", "--long"], p.dir);
  // Both exit 1 when something is outdated.
  if (outdated.code !== 0 && outdated.code !== 1) throw new Error(outdated.err.trim() || `${p.eco} outdated failed`);
  const deps = p.eco === "pnpm" ? parsePnpmOutdated(outdated.out.trim() || "{}") : parseNpmOutdated(outdated.out.trim() || "{}");
  const audit = await run(p.eco === "pnpm" ? ["pnpm", "audit", "--json"] : ["npm", "audit", "--json"], p.dir, 120);
  try {
    const text = audit.out.trim();
    if (!text.startsWith("{")) throw new Error(audit.err.trim().split("\n").pop() || "audit gave no report");
    return { deps, vulns: p.eco === "pnpm" ? parsePnpmAudit(text) : parseNpmAudit(text) };
  } catch (e) {
    return { deps, vulns: null, auditError: String((e as Error).message ?? e) };
  }
}

async function osv(eco: Ecosystem, deps: Dep[]): Promise<Record<string, Vuln[]>> {
  if (!deps.length) return {};
  const dir = `${(await appCacheDir()).replace(/\\/g, "/").replace(/\/+$/, "")}/deps`;
  await native.createDir(dir).catch(() => {});
  const q = `${dir}/osv-${Date.now().toString(36)}.json`;
  await native.writeFile(q, osvQuery(eco, deps), "user");
  const r = await run([CURL, "-sS", "--fail", "-m", "30", "-X", "POST", "-H", "Content-Type: application/json", "--data-binary", `@${q}`, "https://api.osv.dev/v1/querybatch"], dir, 40);
  if (r.code !== 0) throw new Error(r.err.trim() || "OSV lookup failed");
  return parseOsvBatch(r.out, deps);
}

async function scanCargo(p: Project): Promise<{ deps: Dep[]; vulns: Record<string, Vuln[]> | null; auditError?: string }> {
  const meta = await run(["cargo", "metadata", "--format-version", "1"], p.dir, 300);
  if (meta.code !== 0) throw new Error(meta.err.trim().split("\n").slice(-3).join("\n") || "cargo metadata failed");
  const direct = parseCargoMetadata(meta.out);
  const deps = await pool(direct, 6, async (d) => {
    const r = await run([CURL, "-sS", "--fail", "-m", "20", "-A", UA, `https://crates.io/api/v1/crates/${encodeURIComponent(d.name)}`], p.dir, 30);
    return r.code === 0 ? applyCratesInfo(d, r.out) : d;
  });
  try {
    return { deps, vulns: await osv("cargo", deps) };
  } catch (e) {
    return { deps, vulns: null, auditError: String((e as Error).message ?? e) };
  }
}

async function scanGo(p: Project): Promise<{ deps: Dep[]; vulns: Record<string, Vuln[]> | null; auditError?: string }> {
  const r = await run(["go", "list", "-m", "-u", "-json", "all"], p.dir, 300);
  if (r.code !== 0) throw new Error(r.err.trim() || "go list failed");
  const deps = parseGoList(r.out);
  try {
    return { deps, vulns: await osv("go", deps.filter((d) => d.kind !== "indirect")) };
  } catch (e) {
    return { deps, vulns: null, auditError: String((e as Error).message ?? e) };
  }
}

async function scanPython(p: Project): Promise<{ deps: Dep[]; vulns: Record<string, Vuln[]> | null; auditError?: string }> {
  const py = await pythonFor(p.dir);
  if (!py) throw new Error("No Python found (create a .venv or set the Python path in settings)");
  const files: Record<string, string> = {};
  for (const f of ["requirements.txt", "requirements-dev.txt", "pyproject.toml"]) {
    const t = await readText(`${p.dir}/${f}`);
    if (t !== null) files[f] = t;
  }
  const direct = pythonDirectNames(files);
  const r = await run([py, "-m", "pip", "list", "--outdated", "--format", "json", "--disable-pip-version-check"], p.dir, 300);
  if (r.code !== 0) throw new Error(r.err.trim() || "pip list failed");
  const outdated = parsePipOutdated(r.out.trim() || "[]", direct);
  // Advisories for every installed direct requirement, outdated or not.
  const installed = await run([py, "-m", "pip", "list", "--format", "json", "--disable-pip-version-check"], p.dir, 120);
  const all = (JSON.parse(installed.out.trim() || "[]") as { name: string; version: string }[]).filter((x) => direct.has(x.name.toLowerCase().replace(/[-_.]+/g, "-")));
  const deps: Dep[] = [...outdated];
  for (const x of all) if (!deps.some((d) => d.name.toLowerCase() === x.name.toLowerCase())) deps.push({ name: x.name, kind: "prod", current: x.version, wanted: null, latest: x.version, vulns: [] });
  const vulns: Record<string, Vuln[]> = {};
  let failed = 0;
  await pool(
    deps.filter((d) => d.kind !== "indirect"),
    6,
    async (d) => {
      const v = await run([CURL, "-sS", "--fail", "-m", "20", `https://pypi.org/pypi/${encodeURIComponent(d.name)}/${encodeURIComponent(d.current)}/json`], p.dir, 30);
      if (v.code === 0) {
        const list = parsePypiVulns(v.out);
        if (list.length) vulns[d.name] = list;
      } else failed++;
    },
  );
  return { deps, vulns, auditError: failed ? `${failed} advisory lookups failed` : undefined };
}

export async function scan(dir: string): Promise<void> {
  const p = useDepsStore.getState().projects.find((x) => x.dir === dir);
  if (!p) return;
  setProject(dir, { status: "scanning", error: undefined });
  try {
    const r = p.eco === "cargo" ? await scanCargo(p) : p.eco === "go" ? await scanGo(p) : p.eco === "pip" ? await scanPython(p) : await scanNode(p);
    // Vulnerable deps that aren't outdated still need a row.
    const deps = [...r.deps];
    for (const name of Object.keys(r.vulns ?? {})) if (!deps.some((d) => d.name === name)) deps.push({ name, kind: "prod", current: "?", wanted: null, latest: null, vulns: [] });
    for (const d of deps) d.vulns = r.vulns?.[d.name] ?? [];
    setProject(dir, { status: "ready", deps, auditError: r.auditError, scannedAt: Date.now() });
  } catch (e) {
    setProject(dir, { status: "error", error: String((e as Error).message ?? e) });
  }
}

export async function scanAll(): Promise<void> {
  const projects = await discover();
  await pool(projects, 3, (p) => scan(p.dir));
}

// ── upgrades ──────────────────────────────────────────────────────────────

function appendLog(text: string): void {
  useDepsStore.setState((s) => ({ log: (s.log + text).slice(-200_000) }));
}

async function step(argv: string[], cwd: string): Promise<boolean> {
  appendLog(`\n$ ${argv.join(" ")}\n`);
  const r = await run(argv, cwd, 900);
  appendLog(r.out + r.err);
  return r.code === 0;
}

async function afterPython(p: Project, updates: { dep: Dep; version: string }[]): Promise<void> {
  // Keep requirements pins in step with what was installed.
  for (const f of ["requirements.txt", "requirements-dev.txt"]) {
    const path = `${p.dir}/${f}`;
    const text = await readText(path);
    if (text === null) continue;
    const next = updates.reduce((t, u) => bumpRequirement(t, u.dep.name, u.version), text);
    if (next !== text) await native.writeFile(path, next, "user");
  }
}

export async function upgrade(dir: string, updates: { dep: Dep; version: string }[]): Promise<void> {
  const p = useDepsStore.getState().projects.find((x) => x.dir === dir);
  if (!p || !updates.length) return;
  const majors = updates.filter((u) => updateKind(u.dep.current, u.version) === "major");
  if (majors.length && !(await confirmPick(`${majors.length} major update${majors.length > 1 ? "s" : ""} may need code changes`, "Upgrade anyway", majors.map((u) => `${u.dep.name} ${u.dep.current} → ${u.version}`).join(", ")))) return;
  useDepsStore.setState((s) => ({ busy: { ...s.busy, [dir]: true } }));
  const py = p.eco === "pip" ? ((await pythonFor(dir)) ?? undefined) : undefined;
  let ok = 0;
  try {
    // npm / pnpm / yarn / pip take several packages in one command.
    if (p.eco === "npm" || p.eco === "pnpm" || p.eco === "yarn" || p.eco === "pip") {
      const groups = new Map<string, { dep: Dep; version: string }[]>();
      for (const u of updates) {
        const k = u.dep.kind === "dev" ? "dev" : u.dep.kind === "optional" ? "optional" : "prod";
        groups.set(k, [...(groups.get(k) ?? []), u]);
      }
      for (const list of groups.values()) {
        const first = upgradeArgv(p.eco, list[0].dep, list[0].version, py);
        const pkgArgs = list.map((u) => upgradeArgv(p.eco, u.dep, u.version, py)[p.eco === "pip" ? 4 : 2]);
        const argv = [...first.slice(0, p.eco === "pip" ? 4 : 2), ...pkgArgs, ...first.slice(p.eco === "pip" ? 5 : 3)];
        if (await step(argv, dir)) ok += list.length;
      }
      if (p.eco === "pip") await afterPython(p, updates);
    } else {
      for (const u of updates) if (await step(upgradeArgv(p.eco, u.dep, u.version), dir)) ok++;
      if (p.eco === "go" && ok) await step(["go", "mod", "tidy"], dir);
    }
  } finally {
    useDepsStore.setState((s) => ({ busy: { ...s.busy, [dir]: false } }));
  }
  (ok === updates.length ? toast.success : toast.error)(`${ok}/${updates.length} updated in ${p.label}`, ok === updates.length ? undefined : { description: "See the output below the table." });
  await scan(dir);
}

/** Every patch / minor update (the newest the declared range allows, or the newest same-major release). */
export function safeUpdates(p: Project): { dep: Dep; version: string }[] {
  return p.deps
    .filter((d) => d.kind !== "indirect")
    .map((d) => {
      const target = [d.latest, d.wanted].find((v) => v && (updateKind(d.current, v) === "minor" || updateKind(d.current, v) === "patch"));
      return target ? { dep: d, version: target } : null;
    })
    .filter((x): x is { dep: Dep; version: string } => x !== null);
}

export function openDependencies(): void {
  app().openFile(DEPS_PATH);
}
