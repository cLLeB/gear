// Live values for spec arguments, computed in the terminal's directory: git
// branches, package.json scripts, Makefile targets, running containers…
// Results are cached briefly so typing doesn't spawn a process per keystroke.

import { native } from "@/modules/ai/lib/native";
import type { GeneratorId } from "./types";

export type GeneratorValue = { label: string; description?: string };

const TTL_MS = 8000;
const cache = new Map<string, { at: number; values: Promise<GeneratorValue[]> }>();

const lines = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

async function run(command: string, cwd: string): Promise<string> {
  try {
    const out = await native.runCommand(command, cwd, 5);
    return out.exit_code === 0 ? out.stdout : "";
  } catch {
    return "";
  }
}

async function read(path: string): Promise<string | null> {
  try {
    const r = await native.readFile(path);
    return r.kind === "text" ? r.content : null;
  } catch {
    return null;
  }
}

const join = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, "")}/${name}`;

/** Script names from a package.json text, with their commands as descriptions. */
export function parseScripts(packageJson: string): GeneratorValue[] {
  try {
    const scripts = (JSON.parse(packageJson) as { scripts?: Record<string, unknown> }).scripts ?? {};
    return Object.entries(scripts)
      .filter(([, v]) => typeof v === "string")
      .map(([label, v]) => ({ label, description: String(v) }));
  } catch {
    return [];
  }
}

/** Targets from a Makefile (skipping variables, pattern rules and dot-targets). */
export function parseMakeTargets(makefile: string): GeneratorValue[] {
  const seen = new Set<string>();
  const out: GeneratorValue[] = [];
  const lns = makefile.split(/\r?\n/);
  for (let i = 0; i < lns.length; i++) {
    const m = /^([A-Za-z0-9][A-Za-z0-9_./-]*)\s*:(?!=)/.exec(lns[i]);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    const comment = /^##?\s*(.+)$/.exec(lns[i - 1]?.trim() ?? "") ?? /##\s*(.+)$/.exec(lns[i]);
    out.push({ label: m[1], description: comment?.[1] });
  }
  return out;
}

/** Recipe names from `just --summary`. */
export function parseJustSummary(summary: string): GeneratorValue[] {
  return summary
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((label) => ({ label }));
}

/** Paths from `git status --porcelain`, renames reported by their new name. */
export function parsePorcelain(out: string): GeneratorValue[] {
  // Not `lines()`: the leading space of " M file" is part of the status column.
  return out
    .split(/\r?\n/)
    .filter((l) => l.length > 3)
    .map((l) => {
      const status = l.slice(0, 2).trim();
      const path = l.slice(3).replace(/^.* -> /, "").replace(/^"(.*)"$/, "$1");
      return { label: path, description: status || undefined };
    });
}

const KUBE_RESOURCES = ["pods", "deployments", "services", "nodes", "namespaces", "configmaps", "secrets", "ingresses", "jobs", "cronjobs", "statefulsets", "daemonsets", "replicasets", "events", "pv", "pvc"];

async function compute(id: GeneratorId, cwd: string): Promise<GeneratorValue[]> {
  switch (id) {
    case "gitBranches": {
      const out = lines(await run(`git branch -a "--format=%(refname:short)"`, cwd));
      return [...new Set(out.filter((b) => !b.endsWith("/HEAD") && b !== "HEAD"))].map((label) => ({ label }));
    }
    case "gitLocalBranches":
      return lines(await run(`git branch "--format=%(refname:short)"`, cwd)).map((label) => ({ label }));
    case "gitRemotes":
      return lines(await run("git remote", cwd)).map((label) => ({ label }));
    case "gitTags":
      return lines(await run("git tag --sort=-creatordate", cwd)).slice(0, 200).map((label) => ({ label }));
    case "gitChangedFiles":
      return parsePorcelain(await run("git status --porcelain", cwd));
    case "gitStashes":
      return lines(await run(`git stash list "--format=%gd%x09%s"`, cwd)).map((l) => {
        const [label, description] = l.split("\t");
        return { label, description };
      });
    case "npmScripts": {
      const pkg = await read(join(cwd, "package.json"));
      return pkg ? parseScripts(pkg) : [];
    }
    case "makeTargets": {
      for (const name of ["Makefile", "makefile", "GNUmakefile"]) {
        const mk = await read(join(cwd, name));
        if (mk) return parseMakeTargets(mk);
      }
      return [];
    }
    case "justRecipes":
      return parseJustSummary(await run("just --summary", cwd));
    case "dockerContainers":
      return lines(await run(`docker ps -a --format "{{.Names}}|{{.Status}}"`, cwd)).map((l) => {
        const [label, description] = l.split("|");
        return { label, description };
      });
    case "dockerImages":
      return lines(await run(`docker images --format "{{.Repository}}:{{.Tag}}"`, cwd))
        .filter((l) => !l.includes("<none>"))
        .map((label) => ({ label }));
    case "composeServices":
      return lines(await run("docker compose config --services", cwd)).map((label) => ({ label }));
    case "kubeContexts":
      return lines(await run("kubectl config get-contexts -o name", cwd)).map((label) => ({ label }));
    case "kubeResources":
      return KUBE_RESOURCES.map((label) => ({ label }));
  }
}

export function generate(id: GeneratorId, cwd: string): Promise<GeneratorValue[]> {
  const key = `${id}\u0000${cwd}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.values;
  const values = compute(id, cwd).catch(() => []);
  cache.set(key, { at: Date.now(), values });
  return values;
}
