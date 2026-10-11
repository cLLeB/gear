// Pure helpers for dependency hygiene, env-var usage, import resolution and
// bulk renames.

const TOOLING = /^(@types\/|typescript$|eslint|prettier|vite$|vitest$|jest$|@vitejs\/|@testing-library\/|ts-node$|tsx$|nodemon$|husky$|lint-staged$|rimraf$|concurrently$|cross-env$|@tauri-apps\/cli$|tailwindcss$|postcss$|autoprefixer$|@biomejs\/|turbo$|webpack|babel|@babel\/|rollup|esbuild$|@commitlint\/|release-please$|semantic-release$)/;

/** Package name from an import/require specifier ("@a/b/c" → "@a/b", "x/y" → "x"). */
export function packageOf(spec: string): string | null {
  if (/^[./]|^node:|^[a-z]+:\/\//.test(spec) || spec.startsWith("@/") || spec.startsWith("~/")) return null;
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** Import specifiers in JS/TS source (static, dynamic, require, export from). */
export function importSpecifiers(source: string): string[] {
  const out = new Set<string>();
  for (const m of source.matchAll(/(?:import\s[^'"]*?from\s*|import\s*\(\s*|require\s*\(\s*|export\s[^'"]*?from\s*|import\s+)['"]([^'"]+)['"]/g)) out.add(m[1]);
  return [...out];
}

export interface DepReport {
  unused: string[];
  tooling: string[];
  missing: string[];
}

/** Compare declared dependencies with packages actually imported. */
export function dependencyReport(pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }, imported: Set<string>, scripts = ""): DepReport {
  const deps = Object.keys(pkg.dependencies ?? {});
  const dev = Object.keys(pkg.devDependencies ?? {});
  const declared = new Set([...deps, ...dev]);
  const usedInScripts = (name: string) => new RegExp(`(^|[\\s/&;|])${name.replace(/^@[^/]+\//, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([\\s:;&|]|$)`).test(scripts);
  const unused: string[] = [];
  const tooling: string[] = [];
  for (const d of [...deps, ...dev]) {
    if (imported.has(d) || imported.has(d.replace(/^@types\//, ""))) continue;
    if (TOOLING.test(d) || usedInScripts(d)) tooling.push(d);
    else unused.push(d);
  }
  const builtins = new Set(["fs", "path", "os", "url", "util", "crypto", "child_process", "events", "stream", "http", "https", "assert", "buffer", "process", "zlib", "net", "tls", "dns", "readline", "worker_threads", "perf_hooks", "module", "querystring", "string_decoder", "timers", "vm"]);
  const missing = [...imported].filter((p) => !declared.has(p) && !builtins.has(p) && !p.startsWith("virtual:")).sort();
  return { unused: unused.sort(), tooling: tooling.sort(), missing };
}

const COPYLEFT = /\b(A?GPL|LGPL|MPL|EPL|CDDL|EUPL|OSL|SSPL|CC-BY-SA)/i;

export function licenseRisk(license: string): "copyleft" | "unknown" | "permissive" {
  if (!license || /UNLICENSED|SEE LICENSE|unknown/i.test(license)) return "unknown";
  return COPYLEFT.test(license) ? "copyleft" : "permissive";
}

/** Environment variable names read by code in common languages. */
export function envVarsUsed(source: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /process\.env\.([A-Z_][A-Z0-9_]*)/g,
    /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g,
    /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g,
    /os\.environ(?:\.get)?\(?\[?\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
    /os\.getenv\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
    /env::var(?:_os)?\(\s*"([A-Z_][A-Z0-9_]*)"/g,
    /os\.Getenv\(\s*"([A-Z_][A-Z0-9_]*)"/g,
    /Deno\.env\.get\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
    /ENV\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g,
    /System\.getenv\(\s*"([A-Z_][A-Z0-9_]*)"/g,
    /Environment\.GetEnvironmentVariable\(\s*"([A-Z_][A-Z0-9_]*)"/g,
  ];
  for (const re of patterns) for (const m of source.matchAll(re)) out.add(m[1]);
  return [...out];
}

/** Files to try for an import specifier, in resolution order. */
export function importCandidates(fromFile: string, spec: string, root: string, aliases: Record<string, string> = { "@/": "src/", "~/": "src/" }): string[] {
  const dir = fromFile.replace(/\\/g, "/").replace(/\/[^/]*$/, "");
  let base: string | null = null;
  if (spec.startsWith("./") || spec.startsWith("../")) base = normalize(`${dir}/${spec}`);
  else {
    const alias = Object.keys(aliases).find((a) => spec.startsWith(a));
    if (alias) base = normalize(`${root.replace(/\\/g, "/").replace(/\/+$/, "")}/${aliases[alias]}${spec.slice(alias.length)}`);
  }
  if (!base) return [];
  const exts = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".json", ".css", ".scss", ".py", ".rs"];
  const withoutJs = base.replace(/\.(m|c)?js$/, "");
  return [base, ...exts.map((e) => base + e), ...(withoutJs !== base ? [".ts", ".tsx"].map((e) => withoutJs + e) : []), ...["index.ts", "index.tsx", "index.js", "__init__.py", "mod.rs"].map((i) => `${base}/${i}`)];
}

function normalize(p: string): string {
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (part === "..") out.pop();
    else if (part !== "." && part !== "") out.push(part);
  }
  return (p.startsWith("/") ? "/" : "") + out.join("/");
}

/** Python `from a.b import c` / `import a.b` module → relative path candidates. */
export function pythonModuleCandidates(root: string, module: string): string[] {
  const p = `${root.replace(/\\/g, "/").replace(/\/+$/, "")}/${module.replace(/\./g, "/")}`;
  return [`${p}.py`, `${p}/__init__.py`, `${root.replace(/\/+$/, "")}/src/${module.replace(/\./g, "/")}.py`];
}

export interface RenamePlan {
  from: string;
  to: string;
}

/** New names for files whose base name matches `find` (regex), with collision checks. */
export function planRenames(paths: string[], find: RegExp, replace: string): { plans: RenamePlan[]; conflicts: string[] } {
  const plans: RenamePlan[] = [];
  const targets = new Map<string, string>();
  const conflicts: string[] = [];
  const existing = new Set(paths);
  for (const p of paths) {
    const i = p.lastIndexOf("/");
    const dir = p.slice(0, i + 1);
    const name = p.slice(i + 1);
    find.lastIndex = 0;
    if (!find.test(name)) continue;
    find.lastIndex = 0;
    const next = name.replace(find, replace);
    if (next === name || !next) continue;
    const to = dir + next;
    if (targets.has(to) || (existing.has(to) && !paths.some((x) => x === to && plans.some((pl) => pl.from === x)))) conflicts.push(`${name} → ${next}`);
    targets.set(to, p);
    plans.push({ from: p, to });
  }
  return { plans, conflicts };
}
