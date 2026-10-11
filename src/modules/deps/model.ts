// Dependency manager model: semver comparison and Cargo requirement matching,
// parsers for each tool's report (npm / pnpm outdated + audit, cargo metadata
// + crates.io, pip, go list, PyPI / OSV advisories), and upgrade commands.

export type Ecosystem = "npm" | "pnpm" | "yarn" | "cargo" | "pip" | "go";
export type Severity = "critical" | "high" | "moderate" | "low" | "unknown";
export type UpdateKind = "major" | "minor" | "patch" | "prerelease";

export interface Vuln {
  id: string;
  title: string;
  severity: Severity;
  url: string;
  range?: string;
  fixedIn?: string[];
  /** Through which dependency (transitive). */
  via?: string;
}

export interface Dep {
  name: string;
  kind: "prod" | "dev" | "build" | "optional" | "indirect";
  /** Declared requirement, when known. */
  req?: string;
  current: string;
  /** Newest version the requirement allows. */
  wanted: string | null;
  latest: string | null;
  deprecated?: boolean;
  vulns: Vuln[];
}

// ── semver ────────────────────────────────────────────────────────────────

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  pre: string;
}

export function parseVersion(v: string): SemVer | null {
  const m = /^\s*[v=]?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+.]?([0-9A-Za-z.-]+))?/.exec(v);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2] ?? 0), patch: Number(m[3] ?? 0), pre: m[4] && !/^\d+$/.test(m[4]) ? m[4].replace(/^\+.*/, "") : "" };
}

export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return a.localeCompare(b);
  if (x.major !== y.major) return x.major - y.major;
  if (x.minor !== y.minor) return x.minor - y.minor;
  if (x.patch !== y.patch) return x.patch - y.patch;
  if (x.pre === y.pre) return 0;
  // A prerelease sorts before its release.
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre.localeCompare(y.pre, undefined, { numeric: true });
}

/** How big a jump from `from` to `to` is. 0.x minor bumps are breaking, so they count as major. */
export function updateKind(from: string, to: string | null): UpdateKind | null {
  if (!to || compareVersions(to, from) <= 0) return null;
  const a = parseVersion(from);
  const b = parseVersion(to);
  if (!a || !b) return null;
  if (a.major !== b.major) return "major";
  if (a.major === 0 && a.minor !== b.minor) return "major";
  if (a.minor !== b.minor) return "minor";
  if (a.patch !== b.patch) return "patch";
  return "prerelease";
}

/** Does `version` satisfy a Cargo requirement ("1.2", "^1.2", "~1.2.3", "=1.6.0", ">=1, <2", "*")? */
export function satisfiesCargo(version: string, req: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  if (v.pre) return false; // prereleases only match explicit prerelease requirements
  return req.split(",").every((part) => {
    const p = part.trim();
    if (!p || p === "*") return true;
    const m = /^(\^|~|=|>=|<=|>|<)?\s*(\d+|\*)(?:\.(\d+|\*))?(?:\.(\d+|\*))?/.exec(p);
    if (!m) return false;
    const op = m[1] ?? "^";
    const parts = [m[2], m[3], m[4]];
    const nums = parts.map((x) => (x === undefined || x === "*" ? null : Number(x)));
    const [maj, min, pat] = nums;
    const base = `${maj ?? 0}.${min ?? 0}.${pat ?? 0}`;
    const cmp = compareVersions(version, base);
    // Wildcards ("1.*") act like ^ on the given parts.
    if (parts.includes("*")) {
      if (maj === null) return true;
      if (v.major !== maj) return false;
      return min === null || v.minor === min;
    }
    switch (op) {
      case "=":
        return v.major === maj && (min === null || v.minor === min) && (pat === null || v.patch === pat);
      case ">":
        return cmp > 0;
      case ">=":
        return cmp >= 0;
      case "<":
        return cmp < 0;
      case "<=":
        return cmp <= 0;
      case "~":
        if (v.major !== maj) return false;
        if (min === null) return true;
        return v.minor === min && cmp >= 0;
      default: {
        // Caret: the left-most non-zero component must match.
        if (cmp < 0) return false;
        if (maj !== 0) return v.major === maj;
        if (min === null) return v.major === 0;
        if (min !== 0) return v.major === 0 && v.minor === min;
        if (pat === null) return v.major === 0 && v.minor === 0;
        return v.major === 0 && v.minor === 0 && v.patch === pat;
      }
    }
  });
}

export function maxSatisfying(versions: string[], req: string): string | null {
  return versions.filter((v) => satisfiesCargo(v, req)).sort(compareVersions).pop() ?? null;
}

// ── npm / pnpm / yarn ─────────────────────────────────────────────────────

const npmKind = (t: string | undefined): Dep["kind"] => (t === "devDependencies" ? "dev" : t === "optionalDependencies" ? "optional" : "prod");

/** `npm outdated --json --long` (also used for yarn). */
export function parseNpmOutdated(json: string): Dep[] {
  const o = JSON.parse(json || "{}") as Record<string, { current?: string; wanted?: string; latest?: string; type?: string } | { current?: string; wanted?: string; latest?: string; type?: string }[]>;
  return Object.entries(o).map(([name, raw]) => {
    // Workspaces report one entry per dependent.
    const v = Array.isArray(raw) ? raw[0] : raw;
    return { name, kind: npmKind(v.type), current: v.current ?? "missing", wanted: v.wanted ?? null, latest: v.latest ?? null, vulns: [] };
  });
}

export function parsePnpmOutdated(json: string): Dep[] {
  const o = JSON.parse(json || "{}") as Record<string, { current?: string; wanted?: string; latest?: string; dependencyType?: string; isDeprecated?: boolean }>;
  return Object.entries(o).map(([name, v]) => ({ name, kind: npmKind(v.dependencyType), current: v.current ?? "missing", wanted: v.wanted ?? null, latest: v.latest ?? null, deprecated: v.isDeprecated, vulns: [] }));
}

const sev = (s: string | undefined): Severity => (s === "critical" || s === "high" || s === "moderate" || s === "low" ? s : s === "medium" ? "moderate" : "unknown");

/** npm audit v2 (`auditReportVersion: 2`): advisories per *direct* dependency, following `via` chains. */
export function parseNpmAudit(json: string): Record<string, Vuln[]> {
  const a = JSON.parse(json || "{}") as { vulnerabilities?: Record<string, { isDirect?: boolean; via?: (string | { source: number; title: string; url: string; severity: string; range?: string; name?: string })[] }> };
  const vulns = a.vulnerabilities ?? {};
  const out: Record<string, Vuln[]> = {};
  const collect = (name: string, seen: Set<string>, acc: Map<string, Vuln>) => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const v of vulns[name]?.via ?? []) {
      if (typeof v === "string") collect(v, seen, acc);
      else acc.set(String(v.source), { id: v.url.split("/").pop() ?? String(v.source), title: v.title, severity: sev(v.severity), url: v.url, range: v.range, via: v.name && v.name !== [...seen][0] ? v.name : undefined });
    }
  };
  for (const [name, v] of Object.entries(vulns)) {
    if (!v.isDirect) continue;
    const acc = new Map<string, Vuln>();
    collect(name, new Set(), acc);
    out[name] = [...acc.values()];
  }
  return out;
}

/** pnpm audit --json (npm v6 report format). */
export function parsePnpmAudit(json: string): Record<string, Vuln[]> {
  const a = JSON.parse(json || "{}") as { advisories?: Record<string, { id: number; module_name: string; title: string; url: string; severity: string; vulnerable_versions?: string; patched_versions?: string; findings?: { paths: string[] }[]; github_advisory_id?: string }> };
  const out: Record<string, Vuln[]> = {};
  for (const adv of Object.values(a.advisories ?? {})) {
    for (const f of adv.findings ?? []) {
      for (const path of f.paths) {
        const direct = path.split(">")[1];
        if (!direct) continue;
        const list = (out[direct] ??= []);
        if (!list.some((x) => x.id === (adv.github_advisory_id ?? String(adv.id)))) {
          list.push({ id: adv.github_advisory_id ?? String(adv.id), title: adv.title, severity: sev(adv.severity), url: adv.url, range: adv.vulnerable_versions, via: adv.module_name !== direct ? adv.module_name : undefined });
        }
      }
    }
  }
  return out;
}

// ── cargo ─────────────────────────────────────────────────────────────────

interface CargoMeta {
  packages: { name: string; version: string; id: string; source: string | null; manifest_path: string; dependencies: { name: string; req: string; kind: string | null; rename?: string | null; optional?: boolean }[] }[];
  resolve: { root: string | null; nodes: { id: string; deps: { name: string; pkg: string; dep_kinds?: { kind: string | null }[] }[] }[] } | null;
  workspace_members: string[];
}

/** Direct crates.io dependencies of the workspace members with their resolved versions. */
export function parseCargoMetadata(json: string): Dep[] {
  const m = JSON.parse(json) as CargoMeta;
  const byId = new Map(m.packages.map((p) => [p.id, p]));
  const out = new Map<string, Dep>();
  for (const member of m.workspace_members) {
    const pkg = byId.get(member);
    const node = m.resolve?.nodes.find((n) => n.id === member);
    if (!pkg || !node) continue;
    for (const d of pkg.dependencies) {
      const target = node.deps.find((x) => byId.get(x.pkg)?.name === d.name);
      const resolved = target ? byId.get(target.pkg) : undefined;
      if (!resolved || !resolved.source?.startsWith("registry+")) continue;
      const kind: Dep["kind"] = d.kind === "dev" ? "dev" : d.kind === "build" ? "build" : d.optional ? "optional" : "prod";
      const prev = out.get(d.name);
      if (!prev || compareVersions(resolved.version, prev.current) > 0) out.set(d.name, { name: d.name, kind, req: d.req, current: resolved.version, wanted: null, latest: null, vulns: [] });
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Fill wanted / latest from a crates.io API response. */
export function applyCratesInfo(dep: Dep, json: string): Dep {
  const c = JSON.parse(json) as { crate: { max_stable_version?: string | null; max_version: string }; versions: { num: string; yanked: boolean }[] };
  const versions = c.versions.filter((v) => !v.yanked).map((v) => v.num);
  const wanted = dep.req ? maxSatisfying(versions, dep.req) : null;
  return { ...dep, wanted: wanted ?? dep.current, latest: c.crate.max_stable_version ?? c.crate.max_version };
}

// ── pip / go ──────────────────────────────────────────────────────────────

const pyName = (n: string) => n.toLowerCase().replace(/[-_.]+/g, "-");

/** Requirement names declared in requirements*.txt / pyproject.toml. */
export function pythonDirectNames(files: Record<string, string>): Set<string> {
  const names = new Set<string>();
  for (const [path, text] of Object.entries(files)) {
    if (/requirements[^/]*\.txt$/.test(path)) {
      for (const line of text.split(/\r?\n/)) {
        const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line.replace(/#.*/, ""));
        if (m && !line.trim().startsWith("-")) names.add(pyName(m[1]));
      }
    } else if (path.endsWith("pyproject.toml")) {
      const block = /dependencies\s*=\s*\[([\s\S]*?)\]/g;
      for (const b of text.matchAll(block)) for (const s of b[1].matchAll(/["']([A-Za-z0-9][A-Za-z0-9._-]*)/g)) names.add(pyName(s[1]));
      // Poetry: [tool.poetry.dependencies] name = "…"
      const poetry = /\[tool\.poetry\.(?:dev-)?dependencies\]([\s\S]*?)(?:\n\[|$)/g;
      for (const b of text.matchAll(poetry)) for (const s of b[1].matchAll(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/gm)) if (s[1] !== "python") names.add(pyName(s[1]));
    }
  }
  return names;
}

/** `pip list --outdated --format json`, marking which ones are declared directly. */
export function parsePipOutdated(json: string, direct: Set<string>): Dep[] {
  const list = JSON.parse(json || "[]") as { name: string; version: string; latest_version: string }[];
  return list
    .filter((p) => !["pip", "setuptools", "wheel"].includes(p.name.toLowerCase()))
    .map((p) => ({ name: p.name, kind: (direct.size === 0 || direct.has(pyName(p.name)) ? "prod" : "indirect") as Dep["kind"], current: p.version, wanted: null, latest: p.latest_version, vulns: [] }));
}

/** PyPI's per-release JSON carries OSV advisories in `vulnerabilities`. */
export function parsePypiVulns(json: string): Vuln[] {
  const d = JSON.parse(json) as { vulnerabilities?: { id: string; aliases?: string[]; summary?: string | null; details?: string; fixed_in?: string[]; link?: string }[] };
  return (d.vulnerabilities ?? []).map((v) => ({
    id: v.aliases?.find((a) => a.startsWith("GHSA-") || a.startsWith("CVE-")) ?? v.id,
    title: v.summary || (v.details ?? "").split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim().slice(0, 160) || v.id,
    severity: "unknown",
    url: v.link ?? `https://osv.dev/vulnerability/${v.id}`,
    fixedIn: v.fixed_in,
  }));
}

/** `go list -m -u -json all` (a stream of JSON objects). */
export function parseGoList(text: string): Dep[] {
  const out: Dep[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") {
      if (depth++ === 0) start = i;
    } else if (c === "}" && --depth === 0) {
      const m = JSON.parse(text.slice(start, i + 1)) as { Path: string; Version?: string; Main?: boolean; Indirect?: boolean; Update?: { Version: string } };
      if (!m.Main && m.Version) out.push({ name: m.Path, kind: m.Indirect ? "indirect" : "prod", current: m.Version, wanted: m.Update?.Version ?? m.Version, latest: m.Update?.Version ?? m.Version, vulns: [] });
    }
  }
  return out;
}

// ── OSV (crates.io, Go, others) ───────────────────────────────────────────

const OSV_ECOSYSTEM: Partial<Record<Ecosystem, string>> = { cargo: "crates.io", go: "Go", pip: "PyPI", npm: "npm", pnpm: "npm", yarn: "npm" };

export function osvQuery(eco: Ecosystem, deps: Dep[]): string {
  return JSON.stringify({ queries: deps.map((d) => ({ package: { name: d.name, ecosystem: OSV_ECOSYSTEM[eco] }, version: d.current.replace(/^v/, "") })) });
}

export function parseOsvBatch(json: string, deps: Dep[]): Record<string, Vuln[]> {
  const r = JSON.parse(json) as { results: { vulns?: { id: string; summary?: string; database_specific?: { severity?: string } }[] }[] };
  const out: Record<string, Vuln[]> = {};
  r.results.forEach((res, i) => {
    if (res.vulns?.length) out[deps[i].name] = res.vulns.map((v) => ({ id: v.id, title: v.summary ?? v.id, severity: sev(v.database_specific?.severity?.toLowerCase()), url: `https://osv.dev/vulnerability/${v.id}` }));
  });
  return out;
}

// ── upgrades ──────────────────────────────────────────────────────────────

export function upgradeArgv(eco: Ecosystem, dep: Dep, version: string, python?: string): string[] {
  switch (eco) {
    case "npm":
      return ["npm", "install", `${dep.name}@${version}`, ...(dep.kind === "dev" ? ["--save-dev"] : dep.kind === "optional" ? ["--save-optional"] : [])];
    case "pnpm":
      return ["pnpm", "add", `${dep.name}@${version}`, ...(dep.kind === "dev" ? ["-D"] : dep.kind === "optional" ? ["-O"] : [])];
    case "yarn":
      return ["yarn", "add", `${dep.name}@${version}`, ...(dep.kind === "dev" ? ["--dev"] : dep.kind === "optional" ? ["--optional"] : [])];
    case "cargo":
      // Within the requirement: just update the lockfile; beyond it: rewrite the requirement.
      return version === dep.wanted && dep.req && satisfiesCargo(version, dep.req) ? ["cargo", "update", "-p", dep.name, "--precise", version] : ["cargo", "add", `${dep.name}@${version}`, ...(dep.kind === "dev" ? ["--dev"] : dep.kind === "build" ? ["--build"] : [])];
    case "pip":
      return [python ?? "python3", "-m", "pip", "install", `${dep.name}==${version}`];
    case "go":
      return ["go", "get", `${dep.name}@${version}`];
  }
}

/** Update a `name==x` pin in requirements text (keeps extras / markers / comments). */
export function bumpRequirement(text: string, name: string, version: string): string {
  const n = name.replace(/[-_.]+/g, "[-_.]+");
  return text.replace(new RegExp(`^(\\s*${n}(?:\\[[^\\]]*\\])?\\s*)==\\s*[^\\s;#]+`, "gim"), `$1==${version}`);
}

export const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, moderate: 2, low: 1, unknown: 0 };

export function worstSeverity(vs: Vuln[]): Severity | null {
  return vs.length ? vs.reduce<Severity>((a, v) => (SEVERITY_RANK[v.severity] > SEVERITY_RANK[a] ? v.severity : a), vs[0].severity) : null;
}
